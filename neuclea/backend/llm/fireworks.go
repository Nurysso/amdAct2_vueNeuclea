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
	ProviderFireworks Provider = "fireworks"
)

type Client struct {
	Provider     Provider
	OllamaURL    string
	OllamaModel  string
	FireworksURL string
	FireworksKey string
	FireworksMdl string
	HTTP         *http.Client
}

type AgentPlan struct {
	Thought    string                 `json:"thought"`
	Action     string                 `json:"action"`
	Tool       string                 `json:"tool"`
	Parameters map[string]interface{} `json:"parameters"`
	NextSteps  []string               `json:"next_steps"`
}

const systemPrompt = "You are an AI assistant that helps users interact with web services through structured APIs. Always select the most appropriate tool and format responses conversationally."

func NewClient() (*Client, error) {
	_ = godotenv.Load()
	provider := strings.ToLower(strings.TrimSpace(os.Getenv("LLM_PROVIDER")))
	if provider == "" {
		provider = string(ProviderOllama)
	}
	c := &Client{
		Provider:     Provider(provider),
		OllamaURL:    "http://localhost:11434",
		OllamaModel:  getenvDefault("OLLAMA_MODEL", "llama3"),
		FireworksURL: "https://api.fireworks.ai/inference/v1",
		FireworksKey: os.Getenv("FIREWORKS_API_KEY"),
		FireworksMdl: getenvDefault("FIREWORKS_MODEL", "accounts/fireworks/models/glm-5p2"),
		HTTP:         &http.Client{Timeout: 60 * time.Second},
	}
	if c.Provider == ProviderFireworks && c.FireworksKey == "" {
		return nil, fmt.Errorf("FIREWORKS_API_KEY is required when LLM_PROVIDER=fireworks")
	}
	return c, nil
}

func getenvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
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
	Format      string                 `json:"format,omitempty"`
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

func (c *Client) GetAgentPlan(ctx context.Context, prompt string, tools []Tool) (*AgentPlan, error) {
	systemMessage := `You are an AI agent that uses tools to help users.
You must ALWAYS respond with ONLY a valid JSON object.
Do not include any markdown, code blocks, explanations, or other text.
IMPORTANT RULES:
1. You can ONLY use the tools provided in the tools list
2. Do NOT invent or hallucinate tool names
3. If you don't see a tool that matches, use the most appropriate one from the list
4. For product searches, use the tool that has "products" in its name
5. For category listings, use the tool that has "categories" in its name
6. Never use a tool that doesn't exist in the provided list
Example valid response:
{"thought": "I need to search for electronics products", "action": "tool_call", "tool": "list_products_api_products_get", "parameters": {"category": "Electronics"}, "next_steps": ["Display results"]}
Example valid final response:
{"thought": "I have the product information", "action": "final_answer", "next_steps": []}`
	req := chatRequest{
		Model: c.modelName(),
		Messages: []chatMessage{
			{Role: "system", Content: systemMessage},
			{Role: "user", Content: prompt},
		},
		MaxTokens:   800,
		Temperature: 0.0,
		Stream:      false,
	}
	if c.Provider == ProviderOllama {
		req.Format = "json"
	} else {
		req.ResponseFmt = map[string]interface{}{"type": "json_object"}
	}
	body, status, err := c.doRequest(ctx, req)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("LLM returned status %d: %s", status, string(body))
	}
	var resp chatResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("decode LLM response: %w", err)
	}
	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("LLM returned no choices")
	}
	raw := strings.TrimSpace(resp.Choices[0].Message.Content)
	var plan AgentPlan
	if err := json.Unmarshal([]byte(raw), &plan); err == nil {
		if plan.Action == "tool_call" {
			if err := c.validateToolExists(plan.Tool, tools); err != nil {
				similarTool := c.findSimilarTool(plan.Tool, tools)
				if similarTool != "" {
					plan.Tool = similarTool
				} else {
					return nil, fmt.Errorf("tool '%s' not found. Available: %v",
						plan.Tool, c.getToolNames(tools))
				}
			}
			if schema, ok := lookupToolSchema(plan.Tool, tools); ok {
				plan.Parameters = c.normalizeParameterTypes(plan.Parameters, schema)
			}
		}
		if err := c.validateAgentPlan(&plan); err != nil {
			plan = c.extractAgentPlan(raw)
			if err := c.validateAgentPlan(&plan); err != nil {
				return nil, fmt.Errorf("could not parse agent plan: %s", raw)
			}
		}
		return &plan, nil
	}
	plan = c.extractAgentPlan(raw)
	if plan.Action == "tool_call" {
		if err := c.validateToolExists(plan.Tool, tools); err != nil {
			similarTool := c.findSimilarTool(plan.Tool, tools)
			if similarTool != "" {
				plan.Tool = similarTool
			} else {
				return nil, fmt.Errorf("tool '%s' not found in available tools. Available tools: %v", plan.Tool, c.getToolNames(tools))
			}
		}
	}
	if err := c.validateAgentPlan(&plan); err != nil {
		return nil, fmt.Errorf("could not parse agent plan: %s", raw)
	}
	return &plan, nil
}

func lookupToolSchema(name string, tools []Tool) (ToolSchema, bool) {
	for _, t := range tools {
		if t.Name == name {
			return t.Schema, true
		}
	}
	return ToolSchema{}, false
}

func (c *Client) validateToolExists(toolName string, tools []Tool) error {
	for _, tool := range tools {
		if tool.Name == toolName {
			return nil
		}
	}
	return fmt.Errorf("tool '%s' not found", toolName)
}

func (c *Client) findSimilarTool(name string, tools []Tool) string {
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

func (c *Client) getToolNames(tools []Tool) []string {
	names := make([]string, len(tools))
	for i, tool := range tools {
		names[i] = tool.Name
	}
	return names
}

func (c *Client) validateAgentPlan(plan *AgentPlan) error {
	if plan.Thought == "" {
		return fmt.Errorf("missing 'thought' field")
	}
	if plan.Action == "" {
		return fmt.Errorf("missing 'action' field")
	}
	if plan.Action == "tool_call" && plan.Tool == "" {
		return fmt.Errorf("action is 'tool_call' but 'tool' field is missing or empty")
	}
	return nil
}

func (c *Client) extractAgentPlan(raw string) AgentPlan {
	var plan AgentPlan
	cleaned := c.cleanJSONResponse(raw)
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
					var tempPlan AgentPlan
					if err := json.Unmarshal([]byte(candidate), &tempPlan); err == nil {
						if tempPlan.Parameters != nil {
							tempPlan.Parameters = c.normalizeParameterTypes(tempPlan.Parameters, ToolSchema{})
						}
						fmt.Printf("🔧 extractAgentPlan - Found plan: %+v\n", tempPlan)
						return tempPlan
					}
					break
				}
			}
		}
	}
	return plan
}

func (c *Client) cleanJSONResponse(s string) string {
	s = regexp.MustCompile("```(?:json)?\\s*").ReplaceAllString(s, "")
	s = regexp.MustCompile("\\s*```").ReplaceAllString(s, "")
	s = strings.TrimPrefix(s, "json")
	firstBrace := strings.Index(s, "{")
	if firstBrace > 0 {
		s = s[firstBrace:]
	}
	lastBrace := strings.LastIndex(s, "}")
	if lastBrace > 0 && lastBrace < len(s)-1 {
		s = s[:lastBrace+1]
	}
	s = regexp.MustCompile(`,(\s*})`).ReplaceAllString(s, "$1")
	s = regexp.MustCompile(`,(\s*\])`).ReplaceAllString(s, "$1")
	return strings.TrimSpace(s)
}

func (c *Client) extractJSONObjects(s string) []string {
	var objects []string
	var current strings.Builder
	depth := 0
	for _, char := range s {
		if char == '{' {
			if depth == 0 {
				current.Reset()
			}
			current.WriteRune(char)
			depth++
		} else if char == '}' {
			current.WriteRune(char)
			depth--
			if depth == 0 {
				objects = append(objects, current.String())
			}
		} else if depth > 0 {
			current.WriteRune(char)
		}
	}
	return objects
}

func cleanJSONResponse(s string) string {
	s = regexp.MustCompile("```(?:json)?\\s*").ReplaceAllString(s, "")
	s = regexp.MustCompile("\\s*```").ReplaceAllString(s, "")
	s = strings.TrimPrefix(s, "json")
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start >= 0 && end > start {
		s = s[start : end+1]
	}
	s = regexp.MustCompile(`,(\s*})`).ReplaceAllString(s, "$1")
	s = regexp.MustCompile(`,(\s*\])`).ReplaceAllString(s, "$1")
	return strings.TrimSpace(s)
}

func getToolExamples(query string) string {
	lower := strings.ToLower(query)
	if strings.Contains(lower, "category") &&
		(strings.Contains(lower, "product") || strings.Contains(lower, "show") || strings.Contains(lower, "find")) {
		return `✓ Query: "Find products in Electronics"
✓ Tool: list_products_api_products_get
✓ Parameters: {"category": "Electronics", "page": 1, "limit": 10}
✓ Query: "Show me clothing products"
✓ Tool: list_products_api_products_get
✓ Parameters: {"category": "Clothing", "page": 1}`
	} else if strings.Contains(lower, "category") {
		return `✓ Query: "What categories are available?"
✓ Tool: list_categories_api_categories_get
✓ Parameters: {}`
	} else {
		return `✓ Query: "Find products with category Clothing and show their prices"
✓ Tool: list_products_api_products_get
✓ Parameters: {"category": "Clothing", "page": 1, "limit": 10}
✓ Query: "Show me product 456"
✓ Tool: get_product_api_products__product_id__get
✓ Parameters: {"product_id": 456}`
	}
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
3. For category filters, use the exact category name
4. For pagination, use numbers not strings
Respond with ONLY this JSON:
{"tool": "tool_name", "parameters": {"param": "value"}, "reasoning": "explanation"}`,
			validationError, string(toolsJSON), query)
	} else {
		examples := getToolExamples(query)
		userPrompt = fmt.Sprintf(`You are an AI agent that selects tools for e-commerce queries.
Available tools:
%s
User query: "%s"
Examples of correct tool selection:
%s
Rules:
1. Choose the MOST SPECIFIC tool for the query
2. For "products with category X" → use list_products_api_products_get with category parameter
3. For "list categories" → use list_categories_api_categories_get
4. For "show me product 123" → use get_product_api_products__product_id__get
5. NEVER use list_categories_api_categories_get to search for products
6. All parameter values must be correct types (strings in quotes, numbers without quotes)
Response format (ONLY JSON, no other text):
{"tool": "tool_name", "parameters": {"param1": "value1", "param2": 123}, "reasoning": "why this tool"}`,
			string(toolsJSON), query, examples)
	}
	req := chatRequest{
		Model: c.modelName(),
		Messages: []chatMessage{
			{Role: "system", Content: "You are a precise tool selection AI. Always respond with valid JSON only."},
			{Role: "user", Content: userPrompt},
		},
		MaxTokens:   maxTokens,
		Stream:      false,
		Temperature: 0.0,
	}
	if c.Provider == ProviderOllama {
		req.Format = "json"
	} else {
		req.ResponseFmt = map[string]interface{}{"type": "json_object"}
	}
	body, status, err := c.doRequest(ctx, req)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("llm returned status %d: %s", status, string(body))
	}
	var resp chatResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("decode llm response: %w", err)
	}
	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("llm returned no choices")
	}
	raw := strings.TrimSpace(resp.Choices[0].Message.Content)
	fmt.Printf("🔧 SelectTool - Raw LLM response: %s\n", raw)
	choice := c.extractToolChoice(raw, tools)
	if choice == nil {
		return nil, fmt.Errorf("could not parse tool choice from: %q", raw)
	}
	fmt.Printf("🔧 SelectTool - Final normalized choice: %+v\n", choice)
	choice.Parameters = c.normalizeParameterTypes(choice.Parameters, ToolSchema{})
	return choice, nil
}

func (c *Client) normalizeParameterTypes(
	params map[string]interface{},
	schema ToolSchema,
) map[string]interface{} {
	fmt.Printf("🔧 normalizeParameterTypes (schema=%s) - INPUT: %+v\n", schema.Name, params)
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
	fmt.Printf("🔧 normalizeParameterTypes (schema=%s) - OUTPUT: %+v\n", schema.Name, out)
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
		var unq string
		if err := json.Unmarshal([]byte(`"`+s+`"`), &unq); err == nil {
			return unq
		}
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

func isNumeric(s string) bool {
	if s == "" {
		return false
	}
	for i, ch := range s {
		if i == 0 && ch == '-' {
			continue
		}
		if (ch < '0' || ch > '9') && ch != '.' {
			return false
		}
	}
	return true
}

func (c *Client) extractToolChoice(raw string, tools []Tool) *ToolChoice {
	var choice ToolChoice
	if err := json.Unmarshal([]byte(raw), &choice); err == nil {
		fmt.Printf("🔧 extractToolChoice - Before normalization: %+v\n", choice.Parameters)
		if schema, ok := lookupToolSchema(choice.Tool, tools); ok {
			choice.Parameters = c.normalizeParameterTypes(choice.Parameters, schema)
		} else {
		}
		fmt.Printf("🔧 extractToolChoice - After normalization: %+v\n", choice.Parameters)
		return &choice
	}
	start := strings.Index(raw, "{")
	if start >= 0 {
		depth := 0
		for i := start; i < len(raw); i++ {
			if raw[i] == '{' {
				depth++
			} else if raw[i] == '}' {
				depth--
				if depth == 0 {
					candidate := raw[start : i+1]
					if err := json.Unmarshal([]byte(candidate), &choice); err == nil {
						return &choice
					}
					break
				}
			}
		}
	}
	cleaned := c.fixPythonDict(raw)
	if cleaned != raw {
		if err := json.Unmarshal([]byte(cleaned), &choice); err == nil {
			return &choice
		}
	}
	return nil
}

func (c *Client) fixPythonDict(s string) string {
	s = strings.ReplaceAll(s, "'", "\"")
	s = strings.ReplaceAll(s, "None", "null")
	s = strings.ReplaceAll(s, "True", "true")
	s = strings.ReplaceAll(s, "False", "false")
	s = regexp.MustCompile(`,(\s*})`).ReplaceAllString(s, "$1")
	s = regexp.MustCompile(`,(\s*\])`).ReplaceAllString(s, "$1")
	return s
}

func (c *Client) FormatResponse(ctx context.Context, query string, mcpResult interface{}, streamCallback func(string)) (string, error) {
	resultJSON, err := json.Marshal(mcpResult)
	if err != nil {
		return "", fmt.Errorf("marshal mcp result: %w", err)
	}
	userPrompt := fmt.Sprintf(`The user asked: %q
The API returned this data:
%s
Answer the user's question DIRECTLY using only the data above.
- Do NOT describe what the API returns in general.
- Do NOT explain categories unless the user asked about categories.
- If the user asked for names and prices, list ONLY names and prices.
- If results are empty, say so briefly.
- Be concise. No preamble like "Hi! I'm here to help".`, query, string(resultJSON))
	req := chatRequest{
		Model:       c.modelName(),
		Messages:    []chatMessage{{Role: "system", Content: systemPrompt}, {Role: "user", Content: userPrompt}},
		MaxTokens:   500,
		Temperature: 0.3,
	}
	if streamCallback == nil {
		req.Stream = false
		body, status, err := c.doRequest(ctx, req)
		if err != nil {
			return "", err
		}
		if status < 200 || status >= 300 {
			return "", fmt.Errorf("llm returned status %d: %s", status, string(body))
		}
		var resp chatResponse
		if err := json.Unmarshal(body, &resp); err != nil {
			return "", fmt.Errorf("decode llm response: %w", err)
		}
		if len(resp.Choices) == 0 {
			return "", fmt.Errorf("llm returned no choices")
		}
		return resp.Choices[0].Message.Content, nil
	}
	req.Stream = true
	return c.doStream(ctx, req, streamCallback)
}

func (c *Client) modelName() string {
	if c.Provider == ProviderFireworks {
		return c.FireworksMdl
	}
	return c.OllamaModel
}

func (c *Client) doRequest(ctx context.Context, req chatRequest) ([]byte, int, error) {
	if c.Provider == ProviderOllama {
		req.Format = "json"
		req.ResponseFmt = nil
	}
	buf, err := json.Marshal(req)
	if err != nil {
		return nil, 0, err
	}
	url := c.FireworksURL + "/chat/completions"
	if c.Provider == ProviderOllama {
		url = c.OllamaURL + "/v1/chat/completions"
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(buf))
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
		return nil, 0, fmt.Errorf("llm request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

func (c *Client) doStream(ctx context.Context, req chatRequest, cb func(string)) (string, error) {
	buf, err := json.Marshal(req)
	if err != nil {
		return "", err
	}
	url := c.FireworksURL + "/chat/completions"
	if c.Provider == ProviderOllama {
		url = c.OllamaURL + "/v1/chat/completions"
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(buf))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if c.Provider == ProviderFireworks {
		httpReq.Header.Set("Authorization", "Bearer "+c.FireworksKey)
		httpReq.Header.Set("Accept", "text/event-stream")
	}
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("llm stream failed: %w", err)
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
		for _, c := range chunk.Choices {
			if c.Delta.Content != "" {
				full.WriteString(c.Delta.Content)
				cb(c.Delta.Content)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return full.String(), fmt.Errorf("stream read: %w", err)
	}
	return full.String(), nil
}

func extractJSONToolChoice(s string) *ToolChoice {
	start := strings.Index(s, "{")
	if start < 0 {
		return nil
	}
	depth := 0
	for i := start; i < len(s); i++ {
		switch s[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				candidate := s[start : i+1]
				tc := &ToolChoice{}
				if err := json.Unmarshal([]byte(candidate), tc); err == nil {
					return tc
				}
				return nil
			}
		}
	}
	return nil
}
