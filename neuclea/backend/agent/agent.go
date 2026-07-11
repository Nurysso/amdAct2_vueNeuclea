package agent

import (
	"context"
	"encoding/json"
	"fmt"
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
}

type ToolExecution struct {
	Tool       string                 `json:"tool"`
	Parameters map[string]interface{} `json:"parameters"`
	Result     interface{}            `json:"result"`
	Error      string                 `json:"error"`
	Timestamp  time.Time              `json:"timestamp"`
	Success    bool                   `json:"success"`
}

type AgentResponse struct {
	Final      bool            `json:"final"`
	Message    string          `json:"message,omitempty"`
	ToolCalls  []ToolExecution `json:"tool_calls,omitempty"`
	Error      string          `json:"error,omitempty"`
	Thought    string          `json:"thought"`
	Confidence float64         `json:"confidence"`
}

type Agent struct {
	LLM          *llm.Client
	Pool         *mcp.Pool
	MaxSteps     int
	Debug        bool
	ThoughtChain chan string
}

func NewAgent(llmClient *llm.Client, pool *mcp.Pool) *Agent {
	return &Agent{
		LLM:          llmClient,
		Pool:         pool,
		MaxSteps:     5,
		Debug:        true,
		ThoughtChain: make(chan string, 10),
	}
}

func (a *Agent) Execute(ctx context.Context, query string, tools []llm.Tool, endpoint string) (*AgentResponse, error) {
	state := &AgentState{
		Query:       query,
		Tools:       tools,
		ToolHistory: []ToolExecution{},
		MaxSteps:    a.MaxSteps,
		Completed:   false,
		Endpoint:    endpoint,
	}
	toolCallCount := make(map[string]int)
	for !state.Completed && state.CurrentStep < state.MaxSteps {
		state.CurrentStep++
		if a.Debug {
			fmt.Printf("\n🔄 Step %d/%d\n", state.CurrentStep, state.MaxSteps)
		}
		a.sendThought(fmt.Sprintf("🔄 Step %d/%d", state.CurrentStep, state.MaxSteps))
		select {
		case <-ctx.Done():
			return &AgentResponse{
				Final:     true,
				Error:     "Context cancelled: " + ctx.Err().Error(),
				Thought:   "Task cancelled",
				ToolCalls: state.ToolHistory,
			}, nil
		default:
		}
		plan, err := a.think(ctx, state)
		if err != nil {
			return nil, fmt.Errorf("planning failed: %w", err)
		}
		a.sendThought(fmt.Sprintf("Thought %s", plan.Thought))
		if a.Debug {
			fmt.Printf("💭 Thought: %s\n", plan.Thought)
			fmt.Printf("🎯 Action: %s\n", plan.Action)
		}
		if plan.Action == "final_answer" {
			state.Completed = true
			state.FinalResponse = plan.Thought

			// Build a message with the tool results
			var messageBuilder strings.Builder
			if len(state.ToolHistory) > 0 {
				messageBuilder.WriteString("Here are the results:\n\n")
				for _, exec := range state.ToolHistory {
					if exec.Success && exec.Result != nil {
						// Try to format product data
						if resultMap, ok := exec.Result.(map[string]interface{}); ok {
							if data, ok := resultMap["data"]; ok {
								if dataSlice, ok := data.([]interface{}); ok {
									for _, item := range dataSlice {
										if product, ok := item.(map[string]interface{}); ok {
											name, _ := product["name"].(string)
											price, _ := product["price"].(float64)
											messageBuilder.WriteString(fmt.Sprintf("• %s: $%.2f\n", name, price))
										}
									}
								}
							}
						}
					}
				}
			}

			finalMessage := messageBuilder.String()
			if finalMessage == "" {
				finalMessage = plan.Thought
			}

			return &AgentResponse{
				Final:      true,
				Message:    finalMessage,
				ToolCalls:  state.ToolHistory,
				Thought:    plan.Thought,
				Confidence: 0.95,
			}, nil
		}
		if plan.Action == "tool_call" {
			toolCallCount[plan.Tool]++
			if toolCallCount[plan.Tool] > 3 {
				a.sendThought(fmt.Sprintf("⚠️ Too many calls to %s, forcing final answer", plan.Tool))
				if a.Debug {
					fmt.Printf("⚠️ Too many calls to %s, forcing final answer\n", plan.Tool)
				}
				resultMsg := a.formatToolResults(state.ToolHistory)
				if resultMsg != "" {
					return &AgentResponse{
						Final:     true,
						Message:   fmt.Sprintf("I've tried using the %s tool multiple times. Here's what I found:\n\n%s", plan.Tool, resultMsg),
						ToolCalls: state.ToolHistory,
						Thought:   "Completed after multiple attempts",
					}, nil
				}
				return &AgentResponse{
					Final:     true,
					Message:   fmt.Sprintf("I've tried using the %s tool multiple times but couldn't get results.", plan.Tool),
					ToolCalls: state.ToolHistory,
					Thought:   "Completed after multiple attempts",
				}, nil
			}
			a.sendThought(fmt.Sprintf("Calling tool: %s", plan.Tool))
			execution, err := a.executeTool(ctx, state, plan)
			if err != nil {
				execution = &ToolExecution{
					Tool:       plan.Tool,
					Parameters: plan.Parameters,
					Error:      err.Error(),
					Success:    false,
					Timestamp:  time.Now(),
				}
				a.sendThought(fmt.Sprintf("❌ Tool Failed to respond: %s", err.Error()))
				if a.Debug {
					fmt.Printf("❌ Tool execution failed: %v\n", err)
				}
			} else {
				a.sendThought(fmt.Sprintf("✅ Tool executed successfully: %s", plan.Tool))
				if a.Debug {
					fmt.Printf("✅ Tool execution successful\n")
				}
			}
			state.ToolHistory = append(state.ToolHistory, *execution)
		}
	}
	resultMsg := a.formatToolResults(state.ToolHistory)
	if resultMsg != "" {
		return &AgentResponse{
			Final:     true,
			Message:   fmt.Sprintf("Here's what I found:\n\n%s", resultMsg),
			ToolCalls: state.ToolHistory,
			Thought:   "Task completed with available information",
		}, nil
	}
	return &AgentResponse{
		Final:     true,
		Error:     fmt.Sprintf("Max steps (%d) reached without completing task", state.MaxSteps),
		Thought:   "Task incomplete",
		ToolCalls: state.ToolHistory,
	}, nil
}

func (a *Agent) sendThought(thought string) {
	if a.ThoughtChain != nil {
		select {
		case a.ThoughtChain <- thought:
		default:
			// Channel full, skip
		}
	}
}

func (a *Agent) formatToolResults(history []ToolExecution) string {
	if len(history) == 0 {
		return ""
	}
	var result strings.Builder
	for _, exec := range history {
		if exec.Success && exec.Result != nil {
			result.WriteString(fmt.Sprintf("• %s: ", exec.Tool))
			switch v := exec.Result.(type) {
			case map[string]interface{}:
				jsonBytes, _ := json.MarshalIndent(v, "", "  ")
				result.WriteString(string(jsonBytes))
			case []interface{}:
				jsonBytes, _ := json.MarshalIndent(v, "", "  ")
				result.WriteString(string(jsonBytes))
			default:
				result.WriteString(fmt.Sprintf("%v", v))
			}
			result.WriteString("\n\n")
		}
	}
	return result.String()
}

func (a *Agent) think(ctx context.Context, state *AgentState) (*llm.AgentPlan, error) {
	if len(state.ToolHistory) > 2 {
		lastThree := state.ToolHistory[len(state.ToolHistory)-3:]
		allSame := true
		allFailed := true
		for _, exec := range lastThree {
			if exec.Tool != lastThree[0].Tool {
				allSame = false
			}
			if exec.Success {
				allFailed = false
			}
		}
		if allSame && allFailed {
			return &llm.AgentPlan{
				Thought: "I've tried calling the same tool multiple times without success. I'll provide the best answer I can based on the information I have.",
				Action:  "final_answer",
			}, nil
		}
	}
	prompt := a.buildPrompt(state)
	var response *llm.AgentPlan
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		response, err = a.LLM.GetAgentPlan(ctx, prompt, state.Tools)
		if err == nil {
			if response.Action == "tool_call" {
				if response.Tool == "" {
					if attempt < 2 {
						prompt = a.buildPromptWithWarning(state, "ERROR: You must specify a tool name for tool_call actions. Please correct this.")
						continue
					}
					return nil, fmt.Errorf("tool_call action requires a tool name")
				}
				toolExists := false
				for _, tool := range state.Tools {
					if tool.Name == response.Tool {
						toolExists = true
						break
					}
				}
				if !toolExists {
					similarTool := a.findSimilarTool(response.Tool, state.Tools)
					if similarTool != "" {
						response.Tool = similarTool
					} else {
						if attempt < 2 {
							availableTools := a.getToolNames(state.Tools)
							prompt = a.buildPromptWithWarning(state, fmt.Sprintf("ERROR: Tool '%s' does not exist. Available tools: %v. Please use one of these exact tool names.", response.Tool, availableTools))
							continue
						}
						return nil, fmt.Errorf("tool '%s' not found in available tools", response.Tool)
					}
				}
			} else if response.Action != "final_answer" {
				if attempt < 2 {
					prompt = a.buildPromptWithWarning(state, fmt.Sprintf("ERROR: Invalid action '%s'. Must be 'tool_call' or 'final_answer'.", response.Action))
					continue
				}
				return nil, fmt.Errorf("invalid action: %s", response.Action)
			}
			return response, nil
		}
		if attempt < 2 {
			prompt = a.buildPromptWithWarning(state, fmt.Sprintf("ERROR: %v. Please respond with ONLY valid JSON.", err))
		}
	}
	return nil, err
}

func (a *Agent) findSimilarTool(name string, tools []llm.Tool) string {
	nameLower := strings.ToLower(name)
	var bestMatch string
	var bestScore int
	for _, tool := range tools {
		toolLower := strings.ToLower(tool.Name)
		if strings.Contains(toolLower, nameLower) || strings.Contains(nameLower, toolLower) {
			return tool.Name
		}
		score := 0
		for _, ch := range nameLower {
			if strings.ContainsRune(toolLower, ch) {
				score++
			}
		}
		if strings.Contains(toolLower, "product") && strings.Contains(nameLower, "product") {
			score += 5
		}
		if strings.Contains(toolLower, "category") && strings.Contains(nameLower, "category") {
			score += 5
		}
		if strings.Contains(toolLower, "list") && strings.Contains(nameLower, "list") {
			score += 3
		}
		if strings.Contains(toolLower, "get") && strings.Contains(nameLower, "get") {
			score += 3
		}
		if score > bestScore {
			bestScore = score
			bestMatch = tool.Name
		}
	}
	if bestScore > 3 {
		return bestMatch
	}
	return ""
}

func (a *Agent) getToolNames(tools []llm.Tool) []string {
	names := make([]string, len(tools))
	for i, tool := range tools {
		names[i] = tool.Name
	}
	return names
}

func (a *Agent) buildPromptWithWarning(state *AgentState, warning string) string {
	prompt := a.buildPrompt(state)
	return warning + "\n\n" + prompt
}

func (a *Agent) formatParametersWithTypes(tool llm.Tool) string {
	var sb strings.Builder
	if params, ok := tool.Parameters["properties"].(map[string]interface{}); ok {
		sb.WriteString("  Parameters:\n")
		for paramName, paramInfo := range params {
			if info, ok := paramInfo.(map[string]interface{}); ok {
				paramType := info["type"]
				paramDesc := info["description"]
				sb.WriteString(fmt.Sprintf("    - %s (%s): %s\n", paramName, paramType, paramDesc))
				if paramType == "integer" {
					sb.WriteString("      → Use a NUMBER like 1, not a string like \"1\"\n")
				}
			}
		}
	}
	return sb.String()
}

func (a *Agent) executeTool(ctx context.Context, state *AgentState, plan *llm.AgentPlan) (*ToolExecution, error) {
	if state.Endpoint == "" {
		return nil, fmt.Errorf("no MCP endpoint configured")
	}
	client := a.Pool.Get(state.Endpoint)
	if client == nil {
		return nil, fmt.Errorf("MCP client not found for endpoint: %s", state.Endpoint)
	}
	if a.Debug {
		fmt.Printf("🔧 Calling tool: %s with params: %+v\n", plan.Tool, plan.Parameters)
		fmt.Printf("🔧 Parameter types: ")
		for k, v := range plan.Parameters {
			fmt.Printf("%s=%T ", k, v)
		}
		fmt.Println()
	}
	if plan.Parameters == nil {
		plan.Parameters = make(map[string]interface{})
	}
	result, err := client.CallTool(ctx, plan.Tool, plan.Parameters)
	if err != nil {
		if a.Debug {
			fmt.Printf("❌ Tool execution failed: %v\n", err)
		}
		return &ToolExecution{
			Tool:       plan.Tool,
			Parameters: plan.Parameters,
			Error:      err.Error(),
			Success:    false,
			Timestamp:  time.Now(),
		}, err
	}
	if a.Debug {
		fmt.Printf("✅ Tool executed successfully\n")
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
	sb.WriteString("You are a precise AI agent. Your ONLY job is to answer the user's query using the available tools.\n\n")
	sb.WriteString("## User Query (answer THIS exactly):\n")
	sb.WriteString(fmt.Sprintf("%q\n\n", state.Query))
	if len(state.ToolHistory) > 0 {
		sb.WriteString("## Tool Results So Far:\n")
		for i, exec := range state.ToolHistory {
			sb.WriteString(fmt.Sprintf("\nStep %d — Tool: %s\n", i+1, exec.Tool))
			if exec.Success {
				resultJSON, _ := json.MarshalIndent(exec.Result, "", "  ")
				sb.WriteString(fmt.Sprintf("Result:\n%s\n", string(resultJSON)))
			} else {
				sb.WriteString(fmt.Sprintf("Error: %s\n", exec.Error))
			}
		}
		sb.WriteString("\nIf the tool results already contain the data needed to answer the query, respond with action=\"final_answer\".\n")
	}
	sb.WriteString(fmt.Sprintf("\n## Progress: Step %d of %d\n", state.CurrentStep, state.MaxSteps))
	sb.WriteString("\n## Available Tools (use ONLY these exact names):\n")
	for _, tool := range state.Tools {
		sb.WriteString(fmt.Sprintf("\n- %s: %s\n", tool.Name, tool.Description))
		sb.WriteString(a.formatParametersWithTypes(tool))
	}
	sb.WriteString(`
## Parameter Type Rules:
- integer params → numbers: {"page": 1}   NOT {"page": "1"}
- string params  → strings: {"category": "Electronics"}
- boolean params → bare:    {"active": true}
## Response (JSON only):
{"thought": "...", "action": "tool_call"|"final_answer", "tool": "...", "parameters": {...}, "next_steps": [...]}
`)
	return sb.String()
}
