package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"neuclea/handlers"
	"neuclea/llm"
	"neuclea/mcp"
)

func main() {
	// Load .env if present; we still read os.Getenv in the LLM client so this
	// is purely a developer convenience.
	if err := godotenv.Load(); err != nil {
		log.Printf("[%s] no .env file loaded (%v) — falling back to OS env", time.Now().Format(time.RFC3339), err)
	}

	// LLM client. Switches between Ollama and Fireworks based on LLM_PROVIDER.
	llmClient, err := llm.NewClient()
	if err != nil {
		log.Fatalf("[%s] failed to init LLM client: %v", time.Now().Format(time.RFC3339), err)
	}
	log.Printf("[%s] LLM provider=%s", time.Now().Format(time.RFC3339), llmClient.Provider)

	h := handlers.NewHandler(llmClient)
	// Periodic health check on every MCP endpoint. Tick every 30s.
	go runPeriodicHealth(h.Pool, 30*time.Second)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", h.HandleWS)
	mux.HandleFunc("/telemetry", telemetryHandler(h))
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":        true,
			"provider":  llmClient.Provider,
			"timestamp": time.Now().Format(time.RFC3339),
		})
	})

	srv := &http.Server{
		Addr:              ":8080",
		Handler:           withCORS(withRequestLog(mux)),
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Graceful shutdown on SIGINT / SIGTERM.
	idleConnsClosed := make(chan struct{})
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Printf("[%s] shutdown signal received", time.Now().Format(time.RFC3339))
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[%s] http shutdown error: %v", time.Now().Format(time.RFC3339), err)
		}
		h.Pool.Close()
		close(idleConnsClosed)
	}()

	log.Printf("[%s] listening on :8080", time.Now().Format(time.RFC3339))
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[%s] server error: %v", time.Now().Format(time.RFC3339), err)
	}
	<-idleConnsClosed
}

// withCORS adds CORS headers for the frontend and handles preflight requests.
func withCORS(next http.Handler) http.Handler {
	allowed := map[string]bool{
		"https://neuclea-console.vercel.app": true,
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// telemetryHandler returns the public JSON view of all active sessions and
// global predictor stats. Aggregated counts across sessions are also included.
func telemetryHandler(h *handlers.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")

		sessions := h.AllSessions()
		transitions, uniqueFrom := h.Predictor.Stats()

		// Aggregate telemetry across sessions.
		var totalQueries int
		var totalResponseMS int64
		var totalHits, totalSamples int
		active := 0
		for _, s := range sessions {
			if s.Initialized {
				active++
			}
			totalQueries += s.Telemetry.QueryCount
			totalResponseMS += s.Telemetry.TotalResponseMS
			totalHits += s.Telemetry.PredictionHits
			totalSamples += s.Telemetry.PredictionSamples
		}
		var avgMS float64
		if totalQueries > 0 {
			avgMS = float64(totalResponseMS) / float64(totalQueries)
		}
		var accuracy float64
		if totalSamples > 0 {
			accuracy = float64(totalHits) / float64(totalSamples)
		}

		resp := map[string]interface{}{
			"timestamp":            time.Now().Format(time.RFC3339),
			"sessions":             sessions,
			"session_count":        len(sessions),
			"initialized_sessions": active,
			"predictor": map[string]interface{}{
				"transitions_recorded": transitions,
				"unique_from_tools":    uniqueFrom,
			},
			"aggregate": map[string]interface{}{
				"total_queries":       totalQueries,
				"avg_response_ms":     avgMS,
				"prediction_samples":  totalSamples,
				"prediction_hits":     totalHits,
				"prediction_accuracy": accuracy,
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// runPeriodicHealth pings every MCP endpoint on a schedule. Errors are logged
// but not fatal — operators can correlate with /telemetry and /healthz.
func runPeriodicHealth(pool *mcp.Pool, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for range t.C {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := pool.HealthCheck(ctx); err != nil {
			log.Printf("[%s] periodic mcp health: %v", time.Now().Format(time.RFC3339), err)
		}
		cancel()
	}
}

// withRequestLog adds a one-line access log with timestamp and elapsed time.
func withRequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rw, r)
		log.Printf("[%s] %s %s %d %s",
			time.Now().Format(time.RFC3339),
			r.Method, r.URL.Path, rw.status, time.Since(start))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Implement Hijacker to support WebSocket upgrades
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	// Check if the underlying ResponseWriter implements Hijacker
	if hijacker, ok := r.ResponseWriter.(http.Hijacker); ok {
		return hijacker.Hijack()
	}
	return nil, nil, fmt.Errorf("underlying ResponseWriter does not implement http.Hijacker")
}
