package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// ToolCall is a single tool invocation selected by the LLM.
type ToolCall struct {
	Tool       string                 `json:"tool"`
	Parameters map[string]interface{} `json:"parameters"`
}

// ToolPlan is what the LLM returns from PlanToolCalls.
type ToolPlan struct {
	Thought string     `json:"thought"`
	Done    bool       `json:"done"`
	Calls   []ToolCall `json:"calls,omitempty"`
}

// planSystemPrompt is intentionally short — every token here is paid on every round.
const planSystemPrompt = `Agent. Respond ONLY with valid JSON.
If you have enough data: {"thought":"...","done":true,"calls":[]}
If you need more data:   {"thought":"...","done":false,"calls":[{"tool":"name","parameters":{}}]}
Rules: call independent tools in parallel; never re-call a successful tool.`

// PlanToolCalls is kept for interface compatibility — do not use.
func (c *Client) PlanToolCalls(
	ctx context.Context,
	query string,
	tools []Tool,
	history []interface{ isMsgPlaceholder() },
) (*ToolPlan, int, error) {
	panic("use PlanToolCallsH")
}

// HistoryEntry is passed to PlanToolCallsH.
type HistoryEntry struct {
	Tool    string
	Summary string
	Success bool
	Error   string
}

func (c *Client) PlanToolCallsH(
	ctx context.Context,
	query string,
	tools []Tool,
	history []HistoryEntry,
) (*ToolPlan, int, error) {
	userPrompt := buildPlanPrompt(query, tools, history)

	req := c.buildRequest(
		[]chatMessage{
			{Role: "system", Content: planSystemPrompt},
			{Role: "user", Content: userPrompt},
		},
		300, 0.0, false, // 300 max — plan output is tiny JSON
	)

	raw, tokens, err := c.chatWithUsage(ctx, req)
	if err != nil {
		return nil, 0, err
	}

	plan, err := parsePlan(raw, tools)
	if err != nil {
		return nil, tokens, fmt.Errorf("parse plan: %w (raw: %s)", err, raw)
	}
	return plan, tokens, nil
}

// buildPlanPrompt constructs the minimal prompt for each planning round.
// Key token-saving decisions:
//   - Tool descriptions truncated to first sentence only.
//   - Params: only required ones listed; optional omitted unless ≤2 total.
//   - History: counts only ("12 items"), not item previews.
func buildPlanPrompt(query string, tools []Tool, history []HistoryEntry) string {
	var sb strings.Builder

	sb.WriteString("Query: ")
	sb.WriteString(query)
	sb.WriteString("\n\nTools:\n")

	for _, t := range tools {
		// First sentence of description only.
		desc := firstSentence(t.Description)
		sb.WriteString("- ")
		sb.WriteString(t.Name)
		sb.WriteString(": ")
		sb.WriteString(desc)

		// Params: required first, then optional only if ≤2 total params.
		if props, ok := t.Parameters["properties"].(map[string]interface{}); ok && len(props) > 0 {
			required := toStringSet(t.Parameters["required"])
			var reqParts, optParts []string
			for name, info := range props {
				m, _ := info.(map[string]interface{})
				typ, _ := m["type"].(string)
				if typ == "" {
					typ = "any"
				}
				if required[name] {
					reqParts = append(reqParts, name+"("+typ+")*")
				} else {
					optParts = append(optParts, name+"("+typ+")")
				}
			}
			// Always include required; include optional only if there are few total.
			parts := reqParts
			if len(props) <= 3 {
				parts = append(parts, optParts...)
			}
			if len(parts) > 0 {
				sb.WriteString(" [")
				sb.WriteString(strings.Join(parts, ", "))
				sb.WriteString("]")
			}
		}
		sb.WriteString("\n")
	}

	if len(history) > 0 {
		sb.WriteString("\nDone so far:\n")
		for _, h := range history {
			if h.Success {
				// Count-only summary — avoids re-feeding item data back into planner.
				sb.WriteString("✓ ")
				sb.WriteString(h.Tool)
				sb.WriteString(": ")
				sb.WriteString(compactSummary(h.Summary))
				sb.WriteString("\n")
			} else {
				sb.WriteString("✗ ")
				sb.WriteString(h.Tool)
				sb.WriteString(" FAILED: ")
				sb.WriteString(h.Error)
				sb.WriteString("\n")
			}
		}
		sb.WriteString("Enough data to answer? If yes, done=true.\n")
	}

	return sb.String()
}

// firstSentence returns text up to the first '.', '!', or '?' (max 120 chars).
func firstSentence(s string) string {
	s = strings.TrimSpace(s)
	for i, r := range s {
		if (r == '.' || r == '!' || r == '?') && i > 0 {
			return s[:i+1]
		}
		if i >= 120 {
			return s[:120] + "…"
		}
	}
	if len(s) > 120 {
		return s[:120] + "…"
	}
	return s
}

// toStringSet converts a JSON "required" array ([]interface{}) to a fast lookup set.
func toStringSet(v interface{}) map[string]bool {
	out := map[string]bool{}
	if v == nil {
		return out
	}
	switch arr := v.(type) {
	case []interface{}:
		for _, item := range arr {
			if s, ok := item.(string); ok {
				out[s] = true
			}
		}
	case []string:
		for _, s := range arr {
			out[s] = true
		}
	}
	return out
}

// compactSummary reduces a summariseResult string to a planner-readable line.
// The planner needs names to decide done=true — counts alone aren't enough
// (e.g. "18 items" doesn't tell it whether Dune is in the list).
// Format: "N items: Name1, Name2, Name3…" (names only, capped at ~200 chars total)
func compactSummary(s string) string {
	s = strings.TrimSpace(s)

	// Try to parse as JSON to extract names directly.
	// summariseResult produces {"data":[{"name":...},…]} or similar.
	var top map[string]interface{}
	if err := json.Unmarshal([]byte(s), &top); err == nil {
		for _, key := range []string{"data", "items", "results", "products", "categories"} {
			if raw, ok := top[key]; ok {
				if slice, ok := raw.([]interface{}); ok {
					return namesFromSlice(slice, top)
				}
			}
		}
	}

	// Flat JSON array (e.g. ["Electronics","Books"]).
	var flat []interface{}
	if err := json.Unmarshal([]byte(s), &flat); err == nil {
		return namesFromSlice(flat, nil)
	}

	// Fallback: short enough already.
	if len(s) <= 80 {
		return s
	}
	return s[:80] + "…"
}

// namesFromSlice builds "N items: Name1, Name2, …" from a result slice.
// Stays under ~200 chars so the planner prompt stays tight.
func namesFromSlice(slice []interface{}, parent map[string]interface{}) string {
	total := len(slice)
	if t, ok := parent["total"]; ok {
		if n, ok := t.(float64); ok && int(n) > total {
			total = int(n)
		}
	}

	var names []string
	budget := 120 // max chars for the name list — keep round-2 prompt tight
	for _, item := range slice {
		var name string
		switch v := item.(type) {
		case string:
			name = v
		case map[string]interface{}:
			for _, k := range []string{"name", "title", "label"} {
				if n, ok := v[k].(string); ok {
					name = n
					break
				}
			}
		}
		if name == "" {
			continue
		}
		budget -= len(name) + 2
		if budget < 0 {
			names = append(names, "…")
			break
		}
		names = append(names, name)
	}

	if len(names) == 0 {
		return fmt.Sprintf("%d items", total)
	}
	return fmt.Sprintf("%d items: %s", total, strings.Join(names, ", "))
}

func parsePlan(raw string, tools []Tool) (*ToolPlan, error) {
	cleaned := cleanJSON(raw)

	var plan ToolPlan
	if err := json.Unmarshal([]byte(cleaned), &plan); err != nil {
		return nil, fmt.Errorf("unmarshal: %w", err)
	}

	// Validate tool calls — skip unresolvable ones rather than hard-erroring,
	// so a single bad tool name doesn't abort the whole round.
	valid := plan.Calls[:0]
	for _, call := range plan.Calls {
		resolved := resolveToolNameStatic(call.Tool, tools)
		if resolved == "" {
			// Unknown tool — skip it; the agent will re-plan next round.
			continue
		}
		call.Tool = resolved
		if schema, ok := lookupToolSchema(resolved, tools); ok {
			call.Parameters = normalizeParams(call.Parameters, schema)
		}
		valid = append(valid, call)
	}
	plan.Calls = valid

	return &plan, nil
}

func resolveToolNameStatic(name string, tools []Tool) string {
	for _, t := range tools {
		if t.Name == name {
			return name
		}
	}
	lower := strings.ToLower(name)
	var best string
	var bestScore int
	for _, t := range tools {
		tl := strings.ToLower(t.Name)
		if strings.Contains(tl, lower) || strings.Contains(lower, tl) {
			return t.Name
		}
		score := 0
		for _, ch := range lower {
			if strings.ContainsRune(tl, ch) {
				score++
			}
		}
		for _, kw := range []string{"product", "category", "list", "get"} {
			if strings.Contains(tl, kw) && strings.Contains(lower, kw) {
				score += 4
			}
		}
		if score > bestScore {
			bestScore = score
			best = t.Name
		}
	}
	if bestScore > 3 {
		return best
	}
	return ""
}
