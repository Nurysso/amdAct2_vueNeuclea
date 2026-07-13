package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"neuclea/llm"
	"neuclea/mcp"
	"strings"
	"time"
)

type AgentState struct {
	Query         string          `json:"query"`
	Tools         []llm.Tool      `json:"tools"`
	ToolHistory   []ToolExecution `json:"tool_history"`
	CurrentStep   int             `json:"current_step"`
	MaxSteps      int             `json:"max_steps"`
	Completed     bool            `json:"completed"`
	FinalResponse string          `json:"final_response"`
	Error         string          `json:"error"`
	Endpoint      string          `json:"endpoint"`
	TotalTokens   int             `json:"total_tokens"`
}

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
	Confidence  float64         `json:"confidence"`
	TotalTokens int             `json:"total_tokens"`
}

type Agent struct {
	LLM          *llm.Client
	Pool         *mcp.Pool
	MaxSteps     int
	Debug        bool
	ThoughtChain chan string
	logger       *slog.Logger
}

func NewAgent(llmClient *llm.Client, pool *mcp.Pool) *Agent {
	return &Agent{
		LLM:          llmClient,
		Pool:         pool,
		MaxSteps:     5,
		Debug:        true,
		ThoughtChain: make(chan string, 10),
		logger:       slog.Default(),
	}
}

func (a *Agent) WithLogger(l *slog.Logger) *Agent {
	a.logger = l
	return a
}

func summariseResult(tool string, result interface{}) string {
	if result == nil {
		return "(empty)"
	}

	b, err := json.Marshal(result)
	if err != nil {
		return "(unserializable)"
	}

	if len(b) <= 400 {
		return string(b)
	}

	m, ok := result.(map[string]interface{})
	if !ok {
		return string(b[:400]) + "... (truncated)"
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

		total := len(slice)
		preview := slice
		if total > 6 {
			preview = slice[:6]
		}

		pb, _ := json.Marshal(preview)

		meta := map[string]interface{}{
			key:     json.RawMessage(pb),
			"shown": len(preview),
			"total": total,
		}
		if apiTotal, ok := m["total"]; ok {
			meta["total"] = apiTotal
		}
		if tool != "" {
			meta["_tool"] = tool
		}

		out, err := json.Marshal(meta)
		if err != nil {
			return string(pb)
		}
		return string(out)
	}

	return string(b[:400]) + "... (truncated, use tool=" + tool + " for full data)"
}

func (a *Agent) Execute(ctx context.Context, query string, tools []llm.Tool, endpoint string) (*AgentResponse, error) {
	state := &AgentState{
		Query:       query,
		Tools:       tools,
		ToolHistory: []ToolExecution{},
		MaxSteps:    a.MaxSteps,
		Endpoint:    endpoint,
	}
	toolCallCount := make(map[string]int)

	a.logger.Info("agent.start", "query", query, "max_steps", a.MaxSteps)

	for !state.Completed && state.CurrentStep < state.MaxSteps {
		state.CurrentStep++
		a.sendThought(fmt.Sprintf("🔄 Step %d/%d", state.CurrentStep, state.MaxSteps))

		select {
		case <-ctx.Done():
			return &AgentResponse{
				Final:       true,
				Error:       "Context cancelled: " + ctx.Err().Error(),
				Thought:     "Task cancelled",
				ToolCalls:   state.ToolHistory,
				TotalTokens: state.TotalTokens,
			}, nil
		default:
		}

		plan, stepTokens, err := a.think(ctx, state)
		if err != nil {
			return nil, fmt.Errorf("planning failed: %w", err)
		}

		state.TotalTokens += stepTokens
		a.logger.Info("agent.step",
			"step", state.CurrentStep,
			"action", plan.Action,
			"tool", plan.Tool,
			"step_tokens", stepTokens,
			"session_tokens", state.TotalTokens,
		)

		a.sendThought(fmt.Sprintf("Thought %s", plan.Thought))

		if plan.Action == "final_answer" {
			state.Completed = true

			lastResult := lastSuccessfulSummary(state.ToolHistory)
			var formatted string
			var fmtTokens int
			if lastResult != nil {
				formatted, fmtTokens, err = a.LLM.FormatResponseWithUsage(ctx, query, lastResult)
				if err != nil {
					formatted = plan.Thought
				}
			} else {
				formatted = plan.Thought
			}

			state.TotalTokens += fmtTokens
			a.logger.Info("agent.format",
				"format_tokens", fmtTokens,
				"session_tokens", state.TotalTokens,
			)
			a.logger.Info("agent.done",
				"steps", state.CurrentStep,
				"total_tokens", state.TotalTokens,
				"query", query,
			)

			return &AgentResponse{
				Final:       true,
				Message:     formatted,
				ToolCalls:   state.ToolHistory,
				Thought:     plan.Thought,
				Confidence:  0.95,
				TotalTokens: state.TotalTokens,
			}, nil
		}

		if plan.Action == "tool_call" {
			toolCallCount[plan.Tool]++
			if toolCallCount[plan.Tool] > 2 {
				a.sendThought(fmt.Sprintf("⚠️ Too many calls to %s", plan.Tool))
				a.logger.Warn("agent.tool_loop",
					"tool", plan.Tool,
					"count", toolCallCount[plan.Tool],
					"session_tokens", state.TotalTokens,
				)
				resultMsg := a.formatToolResults(state.ToolHistory)
				msg := fmt.Sprintf("Tried %s multiple times.", plan.Tool)
				if resultMsg != "" {
					msg = resultMsg
				}
				return &AgentResponse{
					Final:       true,
					Message:     msg,
					ToolCalls:   state.ToolHistory,
					Thought:     "Completed after multiple attempts",
					TotalTokens: state.TotalTokens,
				}, nil
			}

			a.sendThought(fmt.Sprintf("Calling tool: %s", plan.Tool))
			execution, toolErr := a.executeTool(ctx, state, plan)
			if toolErr != nil {
				isRateLimited := strings.Contains(toolErr.Error(), "rate limited") ||
					strings.Contains(toolErr.Error(), "429")
				if isRateLimited {
					a.sendThought("⏸️ Rate limited")
					a.logger.Warn("agent.rate_limited", "tool", plan.Tool)
					state.ToolHistory = append(state.ToolHistory, ToolExecution{
						Tool:      plan.Tool,
						Error:     "RATE_LIMITED",
						Success:   false,
						Timestamp: time.Now(),
					})
					resultMsg := a.formatToolResults(state.ToolHistory)
					msg := "Rate limited by the data service."
					if resultMsg != "" {
						msg += " Here's what I found:\n\n" + resultMsg
					}
					return &AgentResponse{
						Final:       true,
						Message:     msg,
						ToolCalls:   state.ToolHistory,
						Thought:     "Rate limited",
						TotalTokens: state.TotalTokens,
					}, nil
				}
				execution = &ToolExecution{
					Tool:       plan.Tool,
					Parameters: plan.Parameters,
					Error:      toolErr.Error(),
					Success:    false,
					Timestamp:  time.Now(),
				}
				a.logger.Error("agent.tool_error", "tool", plan.Tool, "error", toolErr.Error())
				a.sendThought(fmt.Sprintf("❌ Tool failed: %s", toolErr.Error()))
			} else {
				execution.ResultSummary = summariseResult(plan.Tool, execution.Result)
				a.logger.Info("agent.tool_ok", "tool", plan.Tool)
				a.sendThought(fmt.Sprintf("✅ Tool executed successfully: %s", plan.Tool))
			}
			state.ToolHistory = append(state.ToolHistory, *execution)
		}
	}

	resultMsg := a.formatToolResults(state.ToolHistory)
	a.logger.Info("agent.done",
		"steps", state.CurrentStep,
		"total_tokens", state.TotalTokens,
		"query", query,
	)
	if resultMsg != "" {
		return &AgentResponse{
			Final:       true,
			Message:     resultMsg,
			ToolCalls:   state.ToolHistory,
			Thought:     "Task completed",
			TotalTokens: state.TotalTokens,
		}, nil
	}
	return &AgentResponse{
		Final:       true,
		Error:       fmt.Sprintf("Max steps (%d) reached", state.MaxSteps),
		Thought:     "Task incomplete",
		ToolCalls:   state.ToolHistory,
		TotalTokens: state.TotalTokens,
	}, nil
}

func lastSuccessfulSummary(history []ToolExecution) interface{} {
	for i := len(history) - 1; i >= 0; i-- {
		if history[i].Success && history[i].ResultSummary != "" {
			return history[i].ResultSummary
		}
	}
	return lastSuccessfulResult(history)
}

func lastSuccessfulResult(history []ToolExecution) interface{} {
	for i := len(history) - 1; i >= 0; i-- {
		if history[i].Success && history[i].Result != nil {
			return history[i].Result
		}
	}
	return nil
}

func (a *Agent) sendThought(thought string) {
	if a.ThoughtChain != nil {
		select {
		case a.ThoughtChain <- thought:
		default:
		}
	}
}

func (a *Agent) formatToolResults(history []ToolExecution) string {
	var result strings.Builder
	for _, exec := range history {
		if exec.Success && exec.Result != nil {
			switch v := exec.Result.(type) {
			case map[string]interface{}:
				if data, ok := v["data"].([]interface{}); ok {
					for _, item := range data {
						if product, ok := item.(map[string]interface{}); ok {
							name, _ := product["name"].(string)
							price, _ := product["price"].(float64)
							if name != "" {
								result.WriteString(fmt.Sprintf("• %s: $%.2f\n", name, price))
							}
						}
					}
					return result.String()
				}
				if name, ok := v["name"].(string); ok {
					price, _ := v["price"].(float64)
					result.WriteString(fmt.Sprintf("• %s: $%.2f\n", name, price))
					return result.String()
				}
			}
		}
	}
	return result.String()
}

func (a *Agent) think(ctx context.Context, state *AgentState) (*llm.AgentPlan, int, error) {
	if len(state.ToolHistory) > 0 {
		last := state.ToolHistory[len(state.ToolHistory)-1]
		if strings.Contains(last.Error, "RATE_LIMITED") {
			return &llm.AgentPlan{
				Thought: "Rate limited. Providing best answer from available data.",
				Action:  "final_answer",
			}, 0, nil
		}
	}
	if len(state.ToolHistory) >= 3 {
		lastThree := state.ToolHistory[len(state.ToolHistory)-3:]
		allSameFailed := true
		for _, exec := range lastThree {
			if exec.Tool != lastThree[0].Tool || exec.Success {
				allSameFailed = false
				break
			}
		}
		if allSameFailed {
			return &llm.AgentPlan{
				Thought: "Same tool failed 3 times. Returning best available answer.",
				Action:  "final_answer",
			}, 0, nil
		}
	}

	prompt := a.buildPrompt(state)
	var lastErr error

	for attempt := 0; attempt < 3; attempt++ {
		response, tokens, err := a.LLM.GetAgentPlanWithUsage(ctx, prompt, state.Tools)
		if err != nil {
			lastErr = err
			prompt = fmt.Sprintf("ERROR: %v. Respond with ONLY valid JSON.\n\n%s", err, prompt)
			continue
		}

		if response.Action == "tool_call" {
			if response.Tool == "" {
				prompt = "ERROR: tool_call requires a non-empty tool name.\n\n" + prompt
				continue
			}
			resolved, resolveErr := a.resolveToolName(response.Tool, state.Tools)
			if resolveErr != nil {
				if attempt < 2 {
					prompt = fmt.Sprintf("ERROR: Tool %q not found. Available: %v\n\n%s",
						response.Tool, a.getToolNames(state.Tools), prompt)
					continue
				}
				return nil, tokens, resolveErr
			}
			response.Tool = resolved
		} else if response.Action != "final_answer" {
			prompt = fmt.Sprintf("ERROR: action must be tool_call or final_answer, got %q\n\n%s",
				response.Action, prompt)
			continue
		}

		return response, tokens, nil
	}
	return nil, 0, fmt.Errorf("think failed after 3 attempts: %w", lastErr)
}

func (a *Agent) resolveToolName(name string, tools []llm.Tool) (string, error) {
	for _, t := range tools {
		if t.Name == name {
			return name, nil
		}
	}
	if similar := a.findSimilarTool(name, tools); similar != "" {
		return similar, nil
	}
	return "", fmt.Errorf("tool %q not found; available: %v", name, a.getToolNames(tools))
}

func (a *Agent) findSimilarTool(name string, tools []llm.Tool) string {
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
		for _, kw := range []string{"product", "category", "list", "get", "search"} {
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

func (a *Agent) getToolNames(tools []llm.Tool) []string {
	names := make([]string, len(tools))
	for i, t := range tools {
		names[i] = t.Name
	}
	return names
}

func (a *Agent) executeTool(ctx context.Context, state *AgentState, plan *llm.AgentPlan) (*ToolExecution, error) {
	if state.Endpoint == "" {
		return nil, fmt.Errorf("no MCP endpoint configured")
	}
	client := a.Pool.Get(state.Endpoint)
	if client == nil {
		return nil, fmt.Errorf("MCP client not found for endpoint: %s", state.Endpoint)
	}
	if plan.Parameters == nil {
		plan.Parameters = make(map[string]interface{})
	}
	result, err := client.CallTool(ctx, plan.Tool, plan.Parameters)
	if err != nil {
		return &ToolExecution{
			Tool:       plan.Tool,
			Parameters: plan.Parameters,
			Error:      err.Error(),
			Success:    false,
			Timestamp:  time.Now(),
		}, err
	}
	return &ToolExecution{
		Tool:       plan.Tool,
		Parameters: plan.Parameters,
		Result:     result,
		Success:    true,
		Timestamp:  time.Now(),
	}, nil
}

func (a *Agent) buildPrompt(state *AgentState) string {
	var sb strings.Builder

	sb.WriteString("You are a precise AI agent. Answer the user's query using the available tools.\n\n")
	sb.WriteString("## Query:\n")
	sb.WriteString(fmt.Sprintf("%q\n\n", state.Query))

	if len(state.ToolHistory) > 0 {
		sb.WriteString("## Tool Results So Far:\n")
		for i, exec := range state.ToolHistory {
			sb.WriteString(fmt.Sprintf("\nStep %d — %s\n", i+1, exec.Tool))
			if exec.Success {
				summary := exec.ResultSummary
				if summary == "" {
					summary = summariseResult(exec.Tool, exec.Result)
				}
				sb.WriteString(fmt.Sprintf("Result (summary): %s\n", summary))
			} else {
				sb.WriteString(fmt.Sprintf("Error: %s\n", exec.Error))
			}
		}
		sb.WriteString("\nIf these results already answer the query, respond with action=\"final_answer\".\n")
	}

	sb.WriteString(fmt.Sprintf("\n## Step %d of %d\n", state.CurrentStep, state.MaxSteps))
	sb.WriteString("\n## Available Tools:\n")
	for _, tool := range state.Tools {
		sb.WriteString(fmt.Sprintf("\n- %s: %s\n", tool.Name, tool.Description))
		sb.WriteString(a.formatParametersWithTypes(tool))
	}

	sb.WriteString(`
## Parameter Types:
- integer → number:  {"page": 1}
- string  → quoted:  {"category": "Electronics"}
- boolean → bare:    {"active": true}

## Response (JSON only):
{"thought":"...","action":"tool_call"|"final_answer","tool":"...","parameters":{...},"next_steps":[]}
`)
	return sb.String()
}

func (a *Agent) formatParametersWithTypes(tool llm.Tool) string {
	var sb strings.Builder
	if params, ok := tool.Parameters["properties"].(map[string]interface{}); ok {
		sb.WriteString("  Parameters:\n")
		for name, info := range params {
			if m, ok := info.(map[string]interface{}); ok {
				sb.WriteString(fmt.Sprintf("    - %s (%v): %v\n", name, m["type"], m["description"]))
			}
		}
	}
	return sb.String()
}

func (a *Agent) buildPromptWithWarning(state *AgentState, warning string) string {
	return warning + "\n\n" + a.buildPrompt(state)
}
