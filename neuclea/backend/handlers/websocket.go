package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"neuclea/agent"
	"neuclea/llm"
	"neuclea/mcp"
	"neuclea/predictor"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type WSMessage struct {
	Type    string          `json:"type"`
	ID      string          `json:"id,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type InitPayload struct {
	Agents AgentsConfig `json:"agents"`
}

type QueryPayload struct {
	Query string `json:"query"`
}

type AutocompletePayload struct {
	Input       string `json:"input"`
	CurrentTool string `json:"current_tool,omitempty"`
}

type ServerResponse struct {
	Type    string      `json:"type"`
	ID      string      `json:"id,omitempty"`
	OK      bool        `json:"ok"`
	Error   string      `json:"error,omitempty"`
	Payload interface{} `json:"payload,omitempty"`
}

type Telemetry struct {
	ToolsUsed         []string `json:"tools_used"`
	QueryCount        int      `json:"query_count"`
	TotalResponseMS   int64    `json:"total_response_ms"`
	PredictionHits    int      `json:"prediction_hits"`
	PredictionSamples int      `json:"prediction_samples"`
}

type session struct {
	id          string
	conn        *websocket.Conn
	mu          sync.Mutex
	config      *AgentsConfig
	tools       map[string]Tool
	lastActive  time.Time
	telemetry   Telemetry
	lastTool    string
	initialized bool
	categories  []string
	endpoint    string
	sleeping    bool
	prefetched  map[string]interface{}
}

type Handler struct {
	LLM         *llm.Client
	Pool        *mcp.Pool
	Predictor   *predictor.Predictor
	Agent       *agent.Agent
	mu          sync.RWMutex
	sessions    map[string]*session
	IdleTimeout time.Duration
	upgrader    websocket.Upgrader
}

func NewHandler(llmClient *llm.Client) *Handler {
	h := &Handler{
		LLM:         llmClient,
		Pool:        mcp.NewPool(),
		Predictor:   predictor.New(),
		sessions:    map[string]*session{},
		IdleTimeout: 2 * time.Minute,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
	h.Agent = agent.NewAgent(llmClient, h.Pool)
	return h
}

func (h *Handler) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[%s] websocket upgrade failed: %v", time.Now().Format(time.RFC3339), err)
		return
	}
	s := &session{
		id:         newSessionID(),
		conn:       conn,
		tools:      map[string]Tool{},
		lastActive: time.Now(),
		telemetry:  Telemetry{ToolsUsed: []string{}},
		prefetched: map[string]interface{}{},
	}
	h.register(s)
	log.Printf("[%s] session %s connected", time.Now().Format(time.RFC3339), s.id)
	go h.idleReaper(s)
	h.readLoop(s)
}

func (h *Handler) register(s *session) {
	h.mu.Lock()
	h.sessions[s.id] = s
	h.mu.Unlock()
}

func (h *Handler) unregister(id string) {
	h.mu.Lock()
	delete(h.sessions, id)
	h.mu.Unlock()
}

func (h *Handler) AllSessions() []SessionSummary {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]SessionSummary, 0, len(h.sessions))
	for _, s := range h.sessions {
		out = append(out, SessionSummary{
			ID:          s.id,
			LastActive:  s.lastActive,
			Initialized: s.initialized,
			Telemetry:   s.telemetry,
		})
	}
	return out
}

type SessionSummary struct {
	ID          string    `json:"id"`
	LastActive  time.Time `json:"last_active"`
	Initialized bool      `json:"initialized"`
	Telemetry   Telemetry `json:"telemetry"`
}

func (h *Handler) readLoop(s *session) {
	defer h.shutdownSession(s, "read loop exited")
	conn := s.conn
	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Minute))
	conn.SetPongHandler(func(string) error {
		_ = conn.SetReadDeadline(time.Now().Add(30 * time.Minute))
		return nil
	})
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[%s] session %s read error: %v", time.Now().Format(time.RFC3339), s.id, err)
			}
			return
		}
		_ = conn.SetReadDeadline(time.Now().Add(h.IdleTimeout))
		s.mu.Lock()
		wasSlepping := s.sleeping
		s.sleeping = false
		s.lastActive = time.Now()
		s.mu.Unlock()
		if wasSlepping {
			h.send(s, ServerResponse{
				Type: "session.resumed",
				OK:   true,
				Payload: map[string]interface{}{
					"message": "Session resumed.",
				},
			})
		}
		var msg WSMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			h.send(s, ServerResponse{Type: "error", OK: false, Error: "invalid json: " + err.Error()})
			continue
		}
		switch msg.Type {
		case "init":
			h.handleInit(s, msg, raw)
		case "query":
			h.handleQuery(s, msg)
		case "autocomplete":
			h.handleAutocomplete(s, msg)
		case "ping":
			h.send(s, ServerResponse{Type: "pong", OK: true})
		default:
			h.send(s, ServerResponse{Type: "error", ID: msg.ID, OK: false, Error: "unknown type: " + msg.Type})
		}
	}
}

func (h *Handler) handleInit(s *session, msg WSMessage, raw []byte) {
	cfg, err := AgentsConfigFromAny(msg.Payload, raw)
	if err != nil {
		h.send(s, ServerResponse{Type: "init", ID: msg.ID, OK: false, Error: "decode config: " + err.Error()})
		return
	}
	fmt.Printf("🔧 Actual URL: %s\n", cfg.MCPServerURL)
	mcpURL := strings.TrimRight(cfg.MCPServerURL, "/")
	endpoint := strings.TrimSuffix(mcpURL, "/mcp")
	if endpoint == "" {
		h.send(s, ServerResponse{Type: "init", ID: msg.ID, OK: false, Error: "mcp_server_url is required"})
		return
	}
	h.Pool.Add(endpoint)
	tools := make(map[string]Tool, len(cfg.Tools))
	for _, t := range cfg.Tools {
		tools[t.Name] = t
	}
	s.mu.Lock()
	s.config = cfg
	s.tools = tools
	s.initialized = true
	go h.fetchCategories(s)
	s.endpoint = endpoint
	s.lastActive = time.Now()
	s.mu.Unlock()
	healthErr := h.Pool.HealthCheck(context.Background())
	payload := map[string]interface{}{
		"session_id":   s.id,
		"tools_loaded": len(tools),
		"endpoint":     endpoint,
		"health_ok":    healthErr == nil,
	}
	if healthErr != nil {
		payload["health_error"] = healthErr.Error()
	}
	h.send(s, ServerResponse{Type: "init", ID: msg.ID, OK: true, Payload: payload})
	log.Printf("[%s] session %s initialized (%d tools, endpoint=%s, healthy=%v)",
		time.Now().Format(time.RFC3339), s.id, len(tools), endpoint, healthErr == nil)
}

func extractCategoryList(result interface{}) []string {
	m, ok := result.(map[string]interface{})
	if !ok {
		return nil
	}
	raw, ok := m["data"]
	if !ok {
		return nil
	}
	switch v := raw.(type) {
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				out = append(out, s)
			} else if m, ok := item.(map[string]interface{}); ok {
				// handle {name: "Electronics"} shape too
				if name, ok := m["name"].(string); ok {
					out = append(out, name)
				}
			}
		}
		return out
	}
	return nil
}

func findSimilarTool(name string, tools map[string]Tool) string {
	nameLower := strings.ToLower(name)
	var best string
	var bestScore int
	for toolName := range tools {
		toolLower := strings.ToLower(toolName)
		if strings.Contains(toolLower, nameLower) || strings.Contains(nameLower, toolLower) {
			return toolName
		}
		score := 0
		for _, c := range nameLower {
			if strings.ContainsRune(toolLower, c) {
				score++
			}
		}
		if score > bestScore {
			bestScore = score
			best = toolName
		}
	}
	if bestScore > len(nameLower)/2 {
		return best
	}
	return ""
}

func (h *Handler) handleQuery(s *session, msg WSMessage) {
	start := time.Now()

	s.mu.Lock()
	initialized := s.initialized
	tools := s.tools
	endpoint := s.endpoint
	// snapshot prefetched under lock — copy so agent can read without holding the lock
	prefetched := make(map[string]interface{}, len(s.prefetched))
	for k, v := range s.prefetched {
		prefetched[k] = v
	}
	s.mu.Unlock()

	if !initialized {
		h.send(s, ServerResponse{Type: "query", ID: msg.ID, OK: false, Error: "session not initialized"})
		return
	}
	if endpoint == "" {
		h.send(s, ServerResponse{Type: "query", ID: msg.ID, OK: false, Error: "MCP endpoint not configured"})
		return
	}

	var p QueryPayload
	if err := json.Unmarshal(msg.Payload, &p); err != nil || strings.TrimSpace(p.Query) == "" {
		h.send(s, ServerResponse{Type: "query", ID: msg.ID, OK: false, Error: "missing query"})
		return
	}

	llmTools := make([]llm.Tool, 0, len(tools))
	for _, t := range tools {
		params := make(map[string]string, len(t.InputSchema.Properties))
		for k, v := range t.InputSchema.Properties {
			params[k] = v.Type
		}
		llmTools = append(llmTools, llm.Tool{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  schemaToMap(t.InputSchema),
			Schema: llm.ToolSchema{
				Name:   t.Name,
				Params: params,
			},
		})
	}

	h.send(s, ServerResponse{
		Type: "query.status",
		ID:   msg.ID,
		OK:   true,
		Payload: map[string]interface{}{
			"message": "🧠 Agent thinking...",
		},
	})

	// Each query gets its own thought channel so concurrent queries don't mix
	thoughtChan := make(chan string, 20)
	h.Agent.ThoughtChain = thoughtChan

	go func() {
		for thought := range thoughtChan {
			h.send(s, ServerResponse{
				Type: "query.thought",
				ID:   msg.ID,
				OK:   true,
				Payload: map[string]interface{}{
					"thought":   thought,
					"timestamp": time.Now().Format(time.RFC3339),
				},
			})
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()

	agentResponse, err := h.Agent.Execute(ctx, p.Query, llmTools, endpoint, prefetched)
	close(thoughtChan) // close once, not twice

	if err != nil {
		log.Printf("[%s] session %s agent error: %v", time.Now().Format(time.RFC3339), s.id, err)
		h.send(s, ServerResponse{Type: "query", ID: msg.ID, OK: false, Error: err.Error()})
		return
	}
	if agentResponse.Error != "" {
		log.Printf("[%s] session %s agent response error: %s", time.Now().Format(time.RFC3339), s.id, agentResponse.Error)
		h.send(s, ServerResponse{Type: "query", ID: msg.ID, OK: false, Error: agentResponse.Error})
		return
	}

	// Send tool events — skip prefetched ones since user didn't see those "called" live
	for _, exec := range agentResponse.ToolCalls {
		if _, wasPrefetched := prefetched[exec.Tool]; wasPrefetched {
			continue // don't surface init-time fetches as query tool calls
		}
		status := fmt.Sprintf("✅ Tool '%s' executed successfully", exec.Tool)
		if !exec.Success {
			status = fmt.Sprintf("⚠️ Tool '%s' failed: %s", exec.Tool, exec.Error)
		}
		h.send(s, ServerResponse{
			Type: "query.tool",
			ID:   msg.ID,
			OK:   true,
			Payload: map[string]interface{}{
				"tool":       exec.Tool,
				"parameters": exec.Parameters,
				"success":    exec.Success,
				"error":      exec.Error,
			},
		})
		h.send(s, ServerResponse{
			Type:    "query.status",
			ID:      msg.ID,
			OK:      true,
			Payload: map[string]interface{}{"message": status},
		})
	}

	// Final answer — agent already formatted it, send directly
	text := agentResponse.Message
	if text == "" {
		text = "I couldn't find any results for your query."
	}
	h.send(s, ServerResponse{
		Type:    "query",
		ID:      msg.ID,
		OK:      true,
		Payload: map[string]string{"text": text},
	})

	// Update predictor with tool sequence from this query
	prev := "__query__"
	for _, exec := range agentResponse.ToolCalls {
		if exec.Success {
			h.Predictor.Record(prev, exec.Tool)
			prev = exec.Tool
		}
	}

	s.mu.Lock()
	s.telemetry.QueryCount++
	elapsed := time.Since(start).Milliseconds()
	s.telemetry.TotalResponseMS += elapsed
	s.lastActive = time.Now()
	s.mu.Unlock()

	log.Printf("[%s] session %s query completed in %dms with %d tool calls (tokens=%d)",
		time.Now().Format(time.RFC3339), s.id, elapsed,
		len(agentResponse.ToolCalls), agentResponse.TotalTokens)
}

func (s *session) extractCategory(query string) string {
	s.mu.Lock()
	cats := s.categories
	s.mu.Unlock()
	lower := strings.ToLower(query)
	for _, cat := range cats {
		if strings.Contains(lower, strings.ToLower(cat)) {
			return cat
		}
	}
	return ""
}

func (h *Handler) fetchCategories(s *session) {
	s.mu.Lock()
	endpoint := s.endpoint
	// find any tool whose name contains "categor" — dynamic, not hardcoded
	categoryTool := ""
	for name := range s.tools {
		if strings.Contains(strings.ToLower(name), "categor") {
			categoryTool = name
			break
		}
	}
	s.mu.Unlock()

	if categoryTool == "" {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result, err := h.Pool.CallTool(ctx, endpoint, categoryTool, map[string]interface{}{})
	if err != nil {
		log.Printf("[%s] fetchCategories failed: %v", time.Now().Format(time.RFC3339), err)
		return
	}

	cats := extractCategoryList(result)

	s.mu.Lock()
	s.categories = cats
	if result != nil {
		s.prefetched[categoryTool] = result
	}
	s.mu.Unlock()

	h.Predictor.Record("__init__", categoryTool)
	log.Printf("[%s] session %s prefetched %q (%d categories)",
		time.Now().Format(time.RFC3339), s.id, categoryTool, len(cats))
}

func extractCategoryFromQuery(query string) string {
	lower := strings.ToLower(query)
	categories := []string{"Electronics", "Clothing", "Books", "Home & Garden"}
	for _, cat := range categories {
		if strings.Contains(lower, strings.ToLower(cat)) {
			return cat
		}
	}
	return ""
}

func getAvailableCategories() string {
	return "Electronics, Clothing, Books, Home & Garden"
}

func validateParameters(params map[string]interface{}, schema JSONSchema) error {
	if params == nil {
		params = make(map[string]interface{})
	}
	for _, required := range schema.Required {
		if _, exists := params[required]; !exists {
			return fmt.Errorf("missing required parameter: %s (example: %s=123)", required, required)
		}
	}
	for key, value := range params {
		prop, exists := schema.Properties[key]
		if !exists {
			continue
		}
		switch prop.Type {
		case "integer", "number":
			switch v := value.(type) {
			case float64:
				if prop.Type == "integer" && v != float64(int(v)) {
					return fmt.Errorf("parameter '%s' must be an integer (got %.2f). Example: %s=10", key, v, key)
				}
			case int, int64:
			case string:
				if num, err := strconv.Atoi(v); err == nil {
					params[key] = num
				} else if num, err := strconv.ParseFloat(v, 64); err == nil {
					params[key] = num
				} else {
					return fmt.Errorf("parameter '%s' should be a number like 10 (got '%s')", key, v)
				}
			default:
				return fmt.Errorf("parameter '%s' should be a number (got %T)", key, value)
			}
		case "string":
			if _, ok := value.(string); !ok {
				return fmt.Errorf("parameter '%s' should be text (got %T)", key, value)
			}
		case "boolean":
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("parameter '%s' should be true or false (got %T)", key, value)
			}
		}
	}
	return nil
}

func (h *Handler) handleAutocomplete(s *session, msg WSMessage) {
	var p AutocompletePayload
	_ = json.Unmarshal(msg.Payload, &p)
	s.mu.Lock()
	tools := s.tools
	lastTool := s.lastTool
	s.mu.Unlock()
	input := strings.ToLower(strings.TrimSpace(p.Input))
	currentTool := p.CurrentTool
	if currentTool == "" {
		currentTool = lastTool
	}
	predicted := h.Predictor.Predict(currentTool, 2)
	matched := []map[string]string{}
	for _, t := range tools {
		if input == "" || strings.Contains(strings.ToLower(t.Name), input) || strings.Contains(strings.ToLower(t.Description), input) {
			matched = append(matched, map[string]string{"name": t.Name, "description": t.Description})
			if len(matched) >= 5 {
				break
			}
		}
	}
	// querySuggestions := suggestQueries(input)
	querySuggestions := h.buildQuerySuggestions(s, input, currentTool)
	h.send(s, ServerResponse{Type: "autocomplete", ID: msg.ID, OK: true, Payload: map[string]interface{}{
		"predicted_tools":   predicted,
		"matched_tools":     matched,
		"query_suggestions": querySuggestions,
		"current_tool":      currentTool,
	}})
}

func (h *Handler) buildQuerySuggestions(s *session, input string, currentTool string) []string {
	s.mu.Lock()
	cats := s.categories
	s.mu.Unlock()

	// Predictor-driven: what tools are likely next?
	predicted := h.Predictor.Predict(currentTool, 3)

	suggestions := []string{}

	// Turn predicted tool names into natural query suggestions
	for _, tool := range predicted {
		switch {
		case strings.Contains(tool, "product"):
			if len(cats) > 0 {
				suggestions = append(suggestions,
					fmt.Sprintf("Show me %s products", cats[0]))
			} else {
				suggestions = append(suggestions, "Show me all products")
			}
		case strings.Contains(tool, "categor"):
			suggestions = append(suggestions, "What categories are available?")
		case strings.Contains(tool, "order"):
			suggestions = append(suggestions, "What's the status of my order?")
		}
	}

	// Input-driven: filter by what user is typing
	if input != "" {
		lower := strings.ToLower(input)
		// Match against live categories
		for _, cat := range cats {
			if strings.Contains(strings.ToLower(cat), lower) {
				suggestions = append(suggestions,
					fmt.Sprintf("Show me %s products", cat),
					fmt.Sprintf("Find cheap %s items", cat),
				)
			}
		}
		// Fallback keyword matching
		switch {
		case strings.Contains(lower, "ord"):
			suggestions = append(suggestions, "What's the status of my order?", "Place a new order")
		case strings.Contains(lower, "track"):
			suggestions = append(suggestions, "Track my latest package", "Where is my delivery?")
		case strings.Contains(lower, "find"), strings.Contains(lower, "search"):
			for _, cat := range cats {
				suggestions = append(suggestions, fmt.Sprintf("Find %s products", cat))
			}
		}
	}

	// Default if nothing matched
	if len(suggestions) == 0 {
		if len(cats) > 0 {
			for _, cat := range cats {
				suggestions = append(suggestions, fmt.Sprintf("Show me %s products", cat))
			}
		} else {
			suggestions = []string{
				"What's the status of my order?",
				"Show me all products",
				"What categories are available?",
			}
		}
	}

	// Deduplicate and cap
	seen := map[string]bool{}
	out := make([]string, 0, 5)
	for _, s := range suggestions {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
		if len(out) >= 5 {
			break
		}
	}
	return out
}

func suggestQueries(input string) []string {
	if input == "" {
		return []string{"What's the status of my order?", "I want to track a package", "Help me with a refund"}
	}
	out := []string{}
	switch {
	case strings.Contains(input, "ord"):
		out = append(out, "What's the status of my order?", "I'd like to place a new order")
	case strings.Contains(input, "track"):
		out = append(out, "Track my latest package", "Where is my delivery?")
	case strings.Contains(input, "comp") || strings.Contains(input, "issue"):
		out = append(out, "I have a complaint about my last order", "I need to file a refund")
	case strings.Contains(input, "email") || strings.Contains(input, "mail"):
		out = append(out, "Draft an email to support", "Reply to the latest customer message")
	case strings.Contains(input, "search") || strings.Contains(input, "find"):
		out = append(out, "Search for products in catalog", "Find stores near me")
	}
	if len(out) == 0 {
		out = append(out, "Help me with "+input)
	}
	return out
}

func (h *Handler) send(s *session, msg ServerResponse) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if err := s.conn.WriteJSON(msg); err != nil {
		log.Printf("[%s] session %s write error: %v", time.Now().Format(time.RFC3339), s.id, err)
	}
}

func (h *Handler) idleReaper(s *session) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		s.mu.Lock()
		idle := time.Since(s.lastActive)
		conn := s.conn
		alreadySleeping := s.sleeping
		s.mu.Unlock()

		if conn == nil {
			return
		}

		// Send a ping to keep TCP alive regardless
		_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
		if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
			h.shutdownSession(s, "ping failed: "+err.Error())
			return
		}

		// Idle threshold: put to sleep (not disconnect)
		if idle > h.IdleTimeout && !alreadySleeping {
			s.mu.Lock()
			s.sleeping = true
			s.mu.Unlock()
			h.send(s, ServerResponse{
				Type: "session.sleeping",
				OK:   true,
				Payload: map[string]interface{}{
					"message":    "Session paused due to inactivity. Send any message to resume.",
					"idle_since": s.lastActive.Format(time.RFC3339),
				},
			})
		}

		// Hard close only after much longer (e.g. 30 min)
		if idle > 30*time.Minute {
			h.shutdownSession(s, fmt.Sprintf("hard timeout after %s idle", idle.Round(time.Second)))
			return
		}
	}
}

func (h *Handler) shutdownSession(s *session, reason string) {
	h.unregister(s.id)
	s.mu.Lock()
	conn := s.conn
	s.conn = nil
	s.mu.Unlock()
	if conn != nil {
		_ = conn.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, reason),
			time.Now().Add(time.Second))
		_ = conn.Close()
	}
	log.Printf("[%s] session %s closed: %s", time.Now().Format(time.RFC3339), s.id, reason)
}

func AgentsConfigFromAny(payload json.RawMessage, raw []byte) (*AgentsConfig, error) {
	if len(payload) > 0 && string(payload) != "null" {
		return UnmarshalAgentsConfig(payload)
	}
	return UnmarshalAgentsConfig(raw)
}

func schemaToMap(s JSONSchema) map[string]interface{} {
	props := map[string]interface{}{}
	for k, v := range s.Properties {
		entry := map[string]interface{}{"type": v.Type, "description": v.Description}
		props[k] = entry
	}
	return map[string]interface{}{
		"type":       s.Type,
		"required":   s.Required,
		"properties": props,
	}
}

var (
	sessionIDMu      sync.Mutex
	sessionIDCounter int64
)

func newSessionID() string {
	sessionIDMu.Lock()
	sessionIDCounter++
	n := sessionIDCounter
	sessionIDMu.Unlock()
	return fmt.Sprintf("sess_%d_%d", time.Now().UnixNano(), n)
}
