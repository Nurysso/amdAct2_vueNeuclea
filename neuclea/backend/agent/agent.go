package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"neuclea/llm"
	"neuclea/mcp"
	"strings"
	"sync"
	"time"
)

type ToolExecution struct {
	Tool          string                 `json:"tool"`
	Parameters    map[string]interface{} `json:"parameters"`
	Result        interface{}            `json:"result"`
	ResultSummary string                 `json:"result_summary"`
	Error         string                 `json:"error"`
	Timestamp     time.Time              `json:"timestamp"`
	Success       bool                   `json:"success"`
}

type AgentResponse struct {
	Final       bool            `json:"final"`
	Message     string          `json:"message,omitempty"`
	ToolCalls   []ToolExecution `json:"tool_calls,omitempty"`
	Error       string          `json:"error,omitempty"`
	Thought     string          `json:"thought"`
	TotalTokens int             `json:"total_tokens"`
}

type Agent struct {
	LLM          *llm.Client
	Pool         *mcp.Pool
	MaxRounds    int
	ThoughtChain chan string
	logger       *slog.Logger
}

func NewAgent(llmClient *llm.Client, pool *mcp.Pool) *Agent {
	return &Agent{
		LLM:          llmClient,
		Pool:         pool,
		MaxRounds:    3,
		ThoughtChain: make(chan string, 20),
		logger:       slog.Default(),
	}
}

func (a *Agent) WithLogger(l *slog.Logger) *Agent {
	a.logger = l
	return a
}

func (a *Agent) sendThought(t string) {
	if a.ThoughtChain == nil {
		return
	}
	select {
	case a.ThoughtChain <- t:
	default:
	}
}

// Execute runs the parallel tool-selection loop.
// prefetched contains results already fetched at session init (e.g. categories).

func (a *Agent) Execute(
	ctx context.Context,
	query string,
	tools []llm.Tool,
	endpoint string,
	prefetched map[string]interface{},
) (*AgentResponse, error) {
	totalTokens := 0
	var history []ToolExecution // full results, stored agent-side

	// Seed from prefetched
	for toolName, result := range prefetched {
		history = append(history, ToolExecution{
			Tool:          toolName,
			Parameters:    map[string]interface{}{},
			Result:        result,
			ResultSummary: summariseResult(toolName, result),
			Success:       true,
			Timestamp:     time.Now(),
		})
		a.logger.Info("agent.prefetch_seeded", "tool", toolName)
	}

	a.logger.Info("agent.start", "query", query, "prefetched", len(prefetched))

	for round := 0; round < a.MaxRounds; round++ {
		a.sendThought(fmt.Sprintf("🔄 Round %d/%d", round+1, a.MaxRounds))

		select {
		case <-ctx.Done():
			return &AgentResponse{
				Final: true, Error: "cancelled",
				ToolCalls: history, TotalTokens: totalTokens,
			}, nil
		default:
		}

		// Build compact history for LLM — summaries only, no raw results
		llmHistory := make([]llm.HistoryEntry, len(history))
		for i, h := range history {
			llmHistory[i] = llm.HistoryEntry{
				Tool:    h.Tool,
				Summary: h.ResultSummary,
				Success: h.Success,
				Error:   h.Error,
			}
		}

		plan, tokens, err := a.LLM.PlanToolCallsH(ctx, query, tools, llmHistory)
		totalTokens += tokens
		if err != nil {
			a.logger.Error("agent.plan_error", "round", round+1, "error", err)
			// Plan failed — try to format from whatever data we have so far
			// rather than propagating a hard error to the user.
			if len(history) > 0 {
				a.sendThought("⚠️ Planning error — formatting from collected data")
				displayData := buildDisplayData(history)
				if len(displayData) > 0 {
					msg, fmtTokens, fmtErr := a.LLM.FormatResponseWithUsage(ctx, query, displayData)
					totalTokens += fmtTokens
					if fmtErr == nil && msg != "" {
						return &AgentResponse{
							Final:       true,
							Message:     msg,
							ToolCalls:   history,
							TotalTokens: totalTokens,
						}, nil
					}
				}
			}
			return nil, fmt.Errorf("round %d plan: %w", round, err)
		}

		a.logger.Info("agent.plan",
			"round", round+1,
			"done", plan.Done,
			"tools", len(plan.Calls),
			"tokens", tokens,
			"session_tokens", totalTokens,
		)
		a.sendThought(fmt.Sprintf("💭 %s", plan.Thought))

		if plan.Done {
			a.sendThought("✅ Formatting answer")

			// Build display-ready data: extract only the fields the LLM needs to
			// write a natural reply (name, price, rating, description). Avoids
			// double-encoding summaries and keeps fmt_tokens low.
			displayData := buildDisplayData(history)

			msg, fmtTokens, fmtErr := a.LLM.FormatResponseWithUsage(ctx, query, displayData)
			totalTokens += fmtTokens
			if fmtErr != nil || msg == "" {
				msg = plan.Thought
			}

			a.logger.Info("agent.done",
				"rounds", round+1,
				"fmt_tokens", fmtTokens,
				"total_tokens", totalTokens,
			)
			return &AgentResponse{
				Final:       true,
				Message:     msg,
				ToolCalls:   history,
				Thought:     plan.Thought,
				TotalTokens: totalTokens,
			}, nil
		}

		if len(plan.Calls) == 0 {
			break
		}

		a.sendThought(fmt.Sprintf("⚡ Calling %d tool(s)", len(plan.Calls)))
		executions := a.executeParallel(ctx, endpoint, plan.Calls)
		history = append(history, executions...)
	}

	a.logger.Warn("agent.max_rounds", "total_tokens", totalTokens)

	// Still have data — try to format a best-effort answer rather than erroring.
	displayData := buildDisplayData(history)
	if len(displayData) > 0 {
		a.sendThought("⚠️ Max rounds reached — formatting best-effort answer")
		msg, fmtTokens, fmtErr := a.LLM.FormatResponseWithUsage(ctx, query, displayData)
		totalTokens += fmtTokens
		if fmtErr == nil && msg != "" {
			a.logger.Info("agent.max_rounds_formatted", "fmt_tokens", fmtTokens, "total_tokens", totalTokens)
			return &AgentResponse{
				Final:       true,
				Message:     msg,
				ToolCalls:   history,
				TotalTokens: totalTokens,
			}, nil
		}
	}
	return &AgentResponse{
		Final: true, Error: "max rounds reached without a conclusive answer",
		ToolCalls: history, TotalTokens: totalTokens,
	}, nil
}

// executeParallel runs all tool calls concurrently and returns results in order.
func (a *Agent) executeParallel(ctx context.Context, endpoint string, calls []llm.ToolCall) []ToolExecution {
	results := make([]ToolExecution, len(calls))
	var wg sync.WaitGroup

	for i, call := range calls {
		wg.Add(1)
		go func(idx int, tc llm.ToolCall) {
			defer wg.Done()

			// Show params in thought so user sees "list_products(category=Books)"
			paramStr := ""
			for k, v := range tc.Parameters {
				if paramStr != "" {
					paramStr += ", "
				}
				paramStr += fmt.Sprintf("%s=%v", k, v)
			}
			label := tc.Tool
			if paramStr != "" {
				label = fmt.Sprintf("%s(%s)", tc.Tool, paramStr)
			}
			a.sendThought(fmt.Sprintf("📞 %s", label))

			ex := ToolExecution{
				Tool:       tc.Tool,
				Parameters: tc.Parameters,
				Timestamp:  time.Now(),
			}

			client := a.Pool.Get(endpoint)
			if client == nil {
				ex.Error = "mcp client not found for endpoint: " + endpoint
				results[idx] = ex
				return
			}

			if tc.Parameters == nil {
				tc.Parameters = map[string]interface{}{}
			}

			result, err := client.CallTool(ctx, tc.Tool, tc.Parameters)
			if err != nil {
				ex.Error = err.Error()
				a.sendThought(fmt.Sprintf("❌ %s failed: %s", label, err.Error()))
			} else {
				ex.Result = result
				ex.ResultSummary = summariseResult(tc.Tool, result)
				ex.Success = true
				a.sendThought(fmt.Sprintf("✅ %s", label))
			}
			results[idx] = ex
		}(i, call)
	}

	wg.Wait()
	return results
}

// displayFields are the only keys forwarded to the LLM for final formatting.
// Keeping this list tight is the single biggest lever on fmt_tokens.
var displayFields = []string{"name", "title", "price", "rating", "description", "category", "stock", "id", "slug"}

// buildDisplayData converts successful tool results into a slim, display-ready
// structure. Multiple calls to the same tool are merged so no results are
// silently overwritten (e.g. 4x list_products across different categories).
func buildDisplayData(history []ToolExecution) map[string]interface{} {
	type accum struct {
		items []interface{}
		total int
	}
	acc := make(map[string]*accum)
	order := make([]string, 0, len(history))

	for _, h := range history {
		if !h.Success || h.Result == nil {
			continue
		}
		if _, seen := acc[h.Tool]; !seen {
			acc[h.Tool] = &accum{}
			order = append(order, h.Tool)
		}
		a := acc[h.Tool]
		slim := slimResult(h.Result)
		// If slimResult returned a keyed list, merge its items.
		if m, ok := slim.(map[string]interface{}); ok {
			merged := false
			for _, key := range []string{"data", "items", "results", "products", "categories"} {
				if raw, ok := m[key]; ok {
					if slice, ok := raw.([]interface{}); ok {
						a.items = append(a.items, slice...)
						if t, ok := m["total"]; ok {
							if n, ok := t.(float64); ok {
								a.total += int(n)
							}
						}
						merged = true
						break
					}
				}
			}
			if !merged {
				a.items = append(a.items, slim)
			}
		} else {
			a.items = append(a.items, slim)
		}
	}

	out := make(map[string]interface{}, len(order))
	for _, tool := range order {
		a := acc[tool]
		if len(a.items) == 1 {
			out[tool] = a.items[0]
		} else {
			total := a.total
			if total == 0 {
				total = len(a.items)
			}
			out[tool] = map[string]interface{}{
				"items": a.items,
				"total": total,
			}
		}
	}
	return out
}

// slimResult strips a raw tool result down to display-relevant fields only.
func slimResult(result interface{}) interface{} {
	m, ok := result.(map[string]interface{})
	if !ok {
		return result
	}
	// If the result has a list key, slim each item in the list.
	for _, key := range []string{"data", "items", "results", "products", "categories"} {
		if raw, ok := m[key]; ok {
			if slice, ok := raw.([]interface{}); ok {
				limit := 10
				if len(slice) < limit {
					limit = len(slice)
				}
				slimmed := make([]interface{}, limit)
				for i, item := range slice[:limit] {
					slimmed[i] = slimItem(item)
				}
				out := map[string]interface{}{key: slimmed}
				if total, ok := m["total"]; ok {
					out["total"] = total
				}
				return out
			}
			// scalar value (e.g. categories as a plain []string)
			return raw
		}
	}
	// Flat object — slim it directly.
	return slimItem(m)
}

// slimItem keeps only displayFields from a map.
// Descriptions are capped at 120 chars — the formatter only needs a one-liner
// to write a natural reply; the full paragraph wastes tokens.
func slimItem(item interface{}) interface{} {
	m, ok := item.(map[string]interface{})
	if !ok {
		return item
	}
	out := make(map[string]interface{}, len(displayFields))
	for _, f := range displayFields {
		v, ok := m[f]
		if !ok {
			continue
		}
		if f == "description" {
			if s, ok := v.(string); ok && len(s) > 120 {
				// Keep first sentence or first 120 chars.
				if dot := strings.IndexAny(s, ".!?"); dot > 0 && dot < 120 {
					v = s[:dot+1]
				} else {
					v = s[:120] + "…"
				}
			}
		}
		out[f] = v
	}
	return out
}

// summariseResult produces a planner-readable summary of a tool result.
// It extracts ALL item names so the planner can reason about content
// (e.g. decide "Dune is in this list, I have enough data → done=true").
// Format: {"data":[{"name":"A"},{"name":"B"},…],"total":N}
// Only the name field is kept — descriptions/prices stay out of the planner.
func summariseResult(_ string, result interface{}) string {
	if result == nil {
		return "(empty)"
	}
	m, ok := result.(map[string]interface{})
	if !ok {
		// Flat value (e.g. scalar string, raw array) — marshal as-is if small.
		b, err := json.Marshal(result)
		if err != nil {
			return "(unserializable)"
		}
		if len(b) <= 300 {
			return string(b)
		}
		return string(b[:300]) + "…"
	}
	for _, key := range []string{"data", "items", "results", "products", "categories"} {
		raw, ok := m[key]
		if !ok {
			continue
		}
		slice, ok := raw.([]interface{})
		if !ok {
			continue
		}
		// Extract name-only objects for every item — keeps the summary small
		// but gives the planner the full name list to reason about.
		nameOnly := make([]map[string]string, 0, len(slice))
		for _, item := range slice {
			im, ok := item.(map[string]interface{})
			if !ok {
				if s, ok := item.(string); ok {
					nameOnly = append(nameOnly, map[string]string{"name": s})
				}
				continue
			}
			for _, k := range []string{"name", "title", "label"} {
				if n, ok := im[k].(string); ok {
					nameOnly = append(nameOnly, map[string]string{"name": n})
					break
				}
			}
		}
		total := len(slice)
		if t, ok := m["total"].(float64); ok && int(t) > total {
			total = int(t)
		}
		out := map[string]interface{}{key: nameOnly, "total": total}
		b, _ := json.Marshal(out)
		return string(b)
	}
	// Flat object with no list key — marshal compactly.
	b, _ := json.Marshal(m)
	if len(b) <= 300 {
		return string(b)
	}
	return string(b[:300]) + "…"
}
