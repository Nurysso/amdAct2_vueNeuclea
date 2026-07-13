package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Provider string

const (
	ProviderOllama    Provider = "ollama"
	ProviderLlamaCpp  Provider = "llamacpp"
	ProviderFireworks Provider = "fireworks"
)

type Client struct {
	Provider     Provider
	BaseURL      string
	Model        string
	FireworksKey string
	HTTP         *http.Client
}

func NewClient() (*Client, error) {
	_ = godotenv.Load()

	provider := detectProvider()
	c := &Client{
		HTTP: &http.Client{Timeout: 120 * time.Second},
	}

	switch provider {
	case ProviderLlamaCpp:
		c.Provider = ProviderLlamaCpp
		c.BaseURL = getenvDefault("LLAMACPP_URL", "http://localhost:8080")
		c.Model = getenvDefault("LLAMACPP_MODEL", "local-model")

	case ProviderOllama:
		c.Provider = ProviderOllama
		c.BaseURL = getenvDefault("OLLAMA_URL", "http://localhost:11434")
		c.Model = getenvDefault("OLLAMA_MODEL", "llama3")

	default:
		key := os.Getenv("FIREWORKS_API_KEY")
		if key == "" {
			return nil, fmt.Errorf(
				"no local LLM server found and FIREWORKS_API_KEY is not set; " +
					"set LLM_PROVIDER=llamacpp or LLM_PROVIDER=ollama for local inference",
			)
		}
		c.Provider = ProviderFireworks
		c.BaseURL = getenvDefault("FIREWORKS_URL", "https://api.fireworks.ai/inference/v1")
		c.Model = getenvDefault("FIREWORKS_MODEL", "accounts/fireworks/models/glm-4-5p2")
		c.FireworksKey = key
	}

	return c, nil
}

func detectProvider() Provider {
	if explicit := strings.ToLower(strings.TrimSpace(os.Getenv("LLM_PROVIDER"))); explicit != "" {
		switch explicit {
		case "llamacpp", "llama.cpp", "llama_cpp":
			return ProviderLlamaCpp
		case "ollama":
			return ProviderOllama
		case "fireworks":
			return ProviderFireworks
		}
	}
	if pingURL(getenvDefault("LLAMACPP_URL", "http://localhost:8080") + "/health") {
		return ProviderLlamaCpp
	}
	if pingURL(getenvDefault("OLLAMA_URL", "http://localhost:11434") + "/api/tags") {
		return ProviderOllama
	}
	return ProviderFireworks
}

func pingURL(url string) bool {
	c := &http.Client{Timeout: 500 * time.Millisecond}
	resp, err := c.Get(url)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode < 500
}

func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

type AgentPlan struct {
	Thought    string                 `json:"thought"`
	Action     string                 `json:"action"`
	Tool       string                 `json:"tool"`
	Parameters map[string]interface{} `json:"parameters"`
	NextSteps  []string               `json:"next_steps"`
}

type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Parameters  map[string]interface{} `json:"parameters,omitempty"`
	Schema      ToolSchema             `json:"-"`
}

type ToolChoice struct {
	Tool       string                 `json:"tool"`
	Parameters map[string]interface{} `json:"parameters"`
	Reasoning  string                 `json:"reasoning"`
}

type ToolSchema struct {
	Name   string
	Params map[string]string
}

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string                 `json:"model"`
	Messages    []chatMessage          `json:"messages"`
	MaxTokens   int                    `json:"max_tokens,omitempty"`
	Temperature float64                `json:"temperature,omitempty"`
	Stream      bool                   `json:"stream"`
	ResponseFmt map[string]interface{} `json:"response_format,omitempty"`
	Format      string                 `json:"format,omitempty"` // Ollama-only
}

type chatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Usage tokenUsage `json:"usage"`
}

type streamChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
}

type tokenUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

func (c *Client) buildRequest(msgs []chatMessage, maxTokens int, temp float64, stream bool) chatRequest {
	req := chatRequest{
		Model:       c.Model,
		Messages:    msgs,
		MaxTokens:   maxTokens,
		Temperature: temp,
		Stream:      stream,
	}
	switch c.Provider {
	case ProviderOllama:
		if !stream {
			req.Format = "json"
		}
	case ProviderLlamaCpp, ProviderFireworks:
		if !stream {
			req.ResponseFmt = map[string]interface{}{"type": "json_object"}
		}
	}
	return req
}

func (c *Client) completionURL() string {
	switch c.Provider {
	case ProviderOllama:
		return c.BaseURL + "/v1/chat/completions"
	case ProviderLlamaCpp:
		return c.BaseURL + "/v1/chat/completions"
	default:
		return c.BaseURL + "/chat/completions"
	}
}

// ---------------------------------------------------------------------------
// Core HTTP transport
// ---------------------------------------------------------------------------

func (c *Client) doRequest(ctx context.Context, req chatRequest) ([]byte, int, error) {
	buf, err := json.Marshal(req)
	if err != nil {
		return nil, 0, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.completionURL(), bytes.NewReader(buf))
	if err != nil {
		return nil, 0, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	if c.Provider == ProviderFireworks {
		httpReq.Header.Set("Authorization", "Bearer "+c.FireworksKey)
	}
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return nil, 0, fmt.Errorf("llm request: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	return body, resp.StatusCode, err
}

func (c *Client) doStream(ctx context.Context, req chatRequest, cb func(string)) (string, error) {
	buf, err := json.Marshal(req)
	if err != nil {
		return "", err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.completionURL(), bytes.NewReader(buf))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	if c.Provider == ProviderFireworks {
		httpReq.Header.Set("Authorization", "Bearer "+c.FireworksKey)
	}
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("llm stream: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("llm stream status %d: %s", resp.StatusCode, string(body))
	}
	var full strings.Builder
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "data:") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		}
		if line == "[DONE]" {
			break
		}
		var chunk streamChunk
		if err := json.Unmarshal([]byte(line), &chunk); err != nil {
			continue
		}
		for _, ch := range chunk.Choices {
			if ch.Delta.Content != "" {
				full.WriteString(ch.Delta.Content)
				cb(ch.Delta.Content)
			}
		}
	}
	return full.String(), scanner.Err()
}

func (c *Client) chat(ctx context.Context, req chatRequest) (string, error) {
	body, status, err := c.doRequest(ctx, req)
	if err != nil {
		return "", err
	}
	if status < 200 || status >= 300 {
		return "", fmt.Errorf("llm status %d: %s", status, string(body))
	}
	var resp chatResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", fmt.Errorf("decode llm response: %w", err)
	}
	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("llm returned no choices")
	}
	return strings.TrimSpace(resp.Choices[0].Message.Content), nil
}

func (c *Client) chatWithUsage(ctx context.Context, req chatRequest) (string, int, error) {
	body, status, err := c.doRequest(ctx, req)
	if err != nil {
		return "", 0, err
	}
	if status < 200 || status >= 300 {
		return "", 0, fmt.Errorf("llm status %d: %s", status, string(body))
	}
	var resp chatResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", 0, fmt.Errorf("decode llm response: %w", err)
	}
	if len(resp.Choices) == 0 {
		return "", 0, fmt.Errorf("llm returned no choices")
	}
	return strings.TrimSpace(resp.Choices[0].Message.Content), resp.Usage.TotalTokens, nil
}

const agentSystemPrompt = `You are an AI agent that uses tools to help users.
You must ALWAYS respond with ONLY a valid JSON object — no markdown, no explanation.
RULES:
1. Only use tools from the provided list. Never invent tool names.
2. For product searches use the tool containing "products" in its name.
3. For category listings use the tool containing "categories" in its name.
4. Parameter values must be the correct type (strings quoted, numbers unquoted).
Example tool call:
{"thought":"I need to search for electronics","action":"tool_call","tool":"list_products_api_products_get","parameters":{"category":"Electronics"},"next_steps":["Display results"]}
Example final answer:
{"thought":"I have the answer","action":"final_answer","tool":"","parameters":{},"next_steps":[]}`

func (c *Client) parseAgentPlan(raw string, tools []Tool) (*AgentPlan, error) {
	cleaned := cleanJSON(raw)
	var plan AgentPlan
	if err := json.Unmarshal([]byte(cleaned), &plan); err != nil {
		// Brace-scan fallback
		start := strings.Index(cleaned, "{")
		if start >= 0 {
			depth := 0
			for i := start; i < len(cleaned); i++ {
				if cleaned[i] == '{' {
					depth++
				} else if cleaned[i] == '}' {
					depth--
					if depth == 0 {
						candidate := cleaned[start : i+1]
						if err2 := json.Unmarshal([]byte(candidate), &plan); err2 != nil {
							return nil, fmt.Errorf("json unmarshal: %w", err)
						}
						break
					}
				}
			}
		} else {
			return nil, fmt.Errorf("json unmarshal: %w", err)
		}
	}

	if err := validatePlan(&plan); err != nil {
		return nil, err
	}

	if plan.Action == "tool_call" {
		resolved, err := c.resolveToolName(plan.Tool, tools)
		if err != nil {
			return nil, err
		}
		plan.Tool = resolved
		if schema, ok := lookupToolSchema(plan.Tool, tools); ok {
			plan.Parameters = normalizeParams(plan.Parameters, schema)
		}
	}

	return &plan, nil
}
func (c *Client) GetAgentPlan(ctx context.Context, prompt string, tools []Tool) (*AgentPlan, error) {
	plan, _, err := c.GetAgentPlanWithUsage(ctx, prompt, tools)
	return plan, err
}

func (c *Client) GetAgentPlanWithUsage(ctx context.Context, prompt string, tools []Tool) (*AgentPlan, int, error) {
	req := c.buildRequest(
		[]chatMessage{
			{Role: "system", Content: agentSystemPrompt},
			{Role: "user", Content: prompt},
		},
		800, 0.0, false,
	)

	raw, tokens, err := c.chatWithUsage(ctx, req)
	if err != nil {
		return nil, 0, err
	}

	plan, err := c.parseAgentPlan(raw, tools)
	if err != nil {
		return nil, tokens, fmt.Errorf("could not parse agent plan: %w (raw: %s)", err, raw)
	}
	return plan, tokens, nil
}

func (c *Client) SelectTool(ctx context.Context, query string, tools []Tool, maxTokens int) (*ToolChoice, error) {
	toolsJSON, err := json.MarshalIndent(tools, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal tools: %w", err)
	}

	validationError := ""
	if ctx != nil {
		if v := ctx.Value("validation_error"); v != nil {
			validationError = v.(string)
		}
	}

	var userPrompt string
	if validationError != "" {
		userPrompt = fmt.Sprintf(`You previously made an error. Please fix it.
Error: %s
Available tools:
%s
User query: "%s"
CRITICAL RULES:
1. Use EXACT tool names from the list above
2. All parameter values must be the correct type:
   - Strings: "Clothing" (with quotes)
   - Numbers: 10, 100 (no quotes)
   - Booleans: true, false (no quotes)
Respond with ONLY this JSON:
{"tool": "tool_name", "parameters": {"param": "value"}, "reasoning": "explanation"}`,
			validationError, string(toolsJSON), query)
	} else {
		userPrompt = fmt.Sprintf(`Available tools:
%s

User query: "%s"

Rules:
1. Choose the MOST SPECIFIC tool for the query.
2. For "products with category X" → list_products tool with category param.
3. For "list categories" → list_categories tool.
4. Parameter types must be correct (strings quoted, numbers unquoted).

Respond with ONLY valid JSON:
{"tool":"tool_name","parameters":{"key":"value"},"reasoning":"why"}`,
			string(toolsJSON), query)
	}

	req := c.buildRequest(
		[]chatMessage{
			{Role: "system", Content: "You are a precise tool-selection AI. Always respond with valid JSON only."},
			{Role: "user", Content: userPrompt},
		},
		maxTokens, 0.0, false,
	)

	raw, err := c.chat(ctx, req)
	if err != nil {
		return nil, err
	}

	choice := c.extractToolChoice(raw, tools)
	if choice == nil {
		return nil, fmt.Errorf("could not parse tool choice from: %q", raw)
	}
	if schema, ok := lookupToolSchema(choice.Tool, tools); ok {
		choice.Parameters = normalizeParams(choice.Parameters, schema)
	}
	return choice, nil
}

const formatSystemPrompt = "You are a helpful, friendly assistant. Answer conversationally and concisely."

func (c *Client) FormatResponse(ctx context.Context, query string, mcpResult interface{}, streamCallback func(string)) (string, error) {
	resultJSON, err := json.Marshal(mcpResult)
	if err != nil {
		return "", fmt.Errorf("marshal mcp result: %w", err)
	}

	userPrompt := c.buildFormatPrompt(query, string(resultJSON))
	req := c.buildRequest(
		[]chatMessage{
			{Role: "system", Content: formatSystemPrompt},
			{Role: "user", Content: userPrompt},
		},
		350, 0.5, streamCallback != nil,
	)

	if streamCallback != nil {
		return c.doStream(ctx, req, streamCallback)
	}
	return c.chat(ctx, req)
}

func (c *Client) FormatResponseWithUsage(ctx context.Context, query string, mcpResult interface{}) (string, int, error) {
	resultJSON, err := json.Marshal(mcpResult)
	if err != nil {
		return "", 0, fmt.Errorf("marshal mcp result: %w", err)
	}

	userPrompt := c.buildFormatPrompt(query, string(resultJSON))
	req := c.buildRequest(
		[]chatMessage{
			{Role: "system", Content: formatSystemPrompt},
			{Role: "user", Content: userPrompt},
		},
		350, 0.5, false,
	)

	return c.chatWithUsage(ctx, req)
}

func (c *Client) buildFormatPrompt(query, resultJSON string) string {
	return fmt.Sprintf(`The user asked: %q

Here is the data retrieved:
%s

Write a natural, conversational reply — as if you're a knowledgeable friend answering them directly.
Rules:
- Lead with the most relevant detail for their question
- Use plain language, no bullet points unless there are 3+ items
- Include price, rating, or key specs only when they add value
- Keep it concise — 1 to 4 sentences for simple queries, a short list for multi-item results
- Never say "Based on the data" or "The API returned" — just answer`, query, resultJSON)
}

func (c *Client) resolveToolName(name string, tools []Tool) (string, error) {
	for _, t := range tools {
		if t.Name == name {
			return name, nil
		}
	}
	if similar := c.findSimilarTool(name, tools); similar != "" {
		return similar, nil
	}
	return "", fmt.Errorf("tool %q not found; available: %v", name, c.getToolNames(tools))
}

func (c *Client) findSimilarTool(name string, tools []Tool) string {
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

func (c *Client) getToolNames(tools []Tool) []string {
	names := make([]string, len(tools))
	for i, t := range tools {
		names[i] = t.Name
	}
	return names
}

func lookupToolSchema(name string, tools []Tool) (ToolSchema, bool) {
	for _, t := range tools {
		if t.Name == name {
			return t.Schema, true
		}
	}
	return ToolSchema{}, false
}

func validatePlan(plan *AgentPlan) error {
	if plan.Thought == "" {
		return fmt.Errorf("missing 'thought'")
	}
	if plan.Action == "" {
		return fmt.Errorf("missing 'action'")
	}
	if plan.Action == "tool_call" && plan.Tool == "" {
		return fmt.Errorf("action=tool_call but 'tool' is empty")
	}
	return nil
}

func (c *Client) extractToolChoice(raw string, tools []Tool) *ToolChoice {
	cleaned := cleanJSON(raw)
	var choice ToolChoice
	if err := json.Unmarshal([]byte(cleaned), &choice); err == nil {
		if schema, ok := lookupToolSchema(choice.Tool, tools); ok {
			choice.Parameters = normalizeParams(choice.Parameters, schema)
		}
		return &choice
	}
	// Brace-scan fallback
	start := strings.Index(raw, "{")
	if start >= 0 {
		depth := 0
		for i := start; i < len(raw); i++ {
			switch raw[i] {
			case '{':
				depth++
			case '}':
				depth--
				if depth == 0 {
					candidate := raw[start : i+1]
					if err := json.Unmarshal([]byte(candidate), &choice); err == nil {
						return &choice
					}
					return nil
				}
			}
		}
	}
	return nil
}

func normalizeParams(params map[string]interface{}, schema ToolSchema) map[string]interface{} {
	if params == nil {
		return map[string]interface{}{}
	}
	out := make(map[string]interface{}, len(params))
	for k, v := range params {
		declared, known := schema.Params[k]
		if !known {
			out[k] = v
			continue
		}
		switch declared {
		case "integer":
			out[k] = coerceInt(v)
		case "number":
			out[k] = coerceFloat(v)
		case "boolean":
			out[k] = coerceBool(v)
		case "string":
			out[k] = coerceString(v)
		case "array":
			out[k] = coerceArray(v)
		default:
			out[k] = v
		}
	}
	return out
}

func coerceInt(v interface{}) interface{} {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case float32:
		return int(x)
	case string:
		if n, err := strconv.Atoi(strings.TrimSpace(x)); err == nil {
			return n
		}
		if f, err := strconv.ParseFloat(strings.TrimSpace(x), 64); err == nil {
			return int(f)
		}
	case bool:
		if x {
			return 1
		}
		return 0
	}
	return v
}

func coerceFloat(v interface{}) interface{} {
	switch x := v.(type) {
	case float64:
		return x
	case float32:
		return float64(x)
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(x), 64); err == nil {
			return f
		}
	}
	return v
}

func coerceBool(v interface{}) interface{} {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		switch strings.ToLower(strings.TrimSpace(x)) {
		case "true", "1", "yes":
			return true
		case "false", "0", "no":
			return false
		}
	case float64:
		return x != 0
	case int:
		return x != 0
	}
	return v
}

func coerceString(v interface{}) string {
	s, ok := v.(string)
	if !ok {
		return fmt.Sprintf("%v", v)
	}
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		var unq string
		if err := json.Unmarshal([]byte(s), &unq); err == nil && unq != "" {
			return unq
		}
		return s[1 : len(s)-1]
	}
	if strings.Contains(s, `\"`) {
		s = strings.ReplaceAll(s, `\"`, `"`)
	}
	return s
}

func coerceArray(v interface{}) interface{} {
	switch x := v.(type) {
	case []interface{}:
		return x
	case string:
		var arr []interface{}
		if err := json.Unmarshal([]byte(x), &arr); err == nil {
			return arr
		}
		return []interface{}{x}
	}
	return []interface{}{v}
}

var (
	reMDFence    = regexp.MustCompile("```(?:json)?\\s*|\\s*```")
	reTrailComma = regexp.MustCompile(`,(\s*[}\]])`)
)

func cleanJSON(s string) string {
	s = reMDFence.ReplaceAllString(s, "")
	s = strings.TrimPrefix(s, "json")
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		s = s[start : end+1]
	}
	s = reTrailComma.ReplaceAllString(s, "$1")
	return strings.TrimSpace(s)
}
