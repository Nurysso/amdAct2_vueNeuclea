package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Client struct {
	Endpoint   string
	HTTP       *http.Client
	mu         sync.Mutex
	lastUsed   time.Time
	healthy    bool
	lastCheck  time.Time
	checkEvery time.Duration
}

func NewClient(endpoint string) *Client {
	return &Client{
		Endpoint:   endpoint,
		HTTP:       &http.Client{Timeout: 30 * time.Second},
		checkEvery: 30 * time.Second,
	}
}

func (c *Client) Health(ctx context.Context) error {
	c.mu.Lock()
	if time.Since(c.lastCheck) < c.checkEvery && c.healthy {
		c.mu.Unlock()
		return nil
	}
	c.mu.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.Endpoint+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		c.mu.Lock()
		c.healthy = false
		c.lastCheck = time.Now()
		c.mu.Unlock()
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	c.mu.Lock()
	c.healthy = resp.StatusCode >= 200 && resp.StatusCode < 300
	c.lastCheck = time.Now()
	c.mu.Unlock()

	if !c.healthy {
		return fmt.Errorf("mcp health check returned %d", resp.StatusCode)
	}
	return nil
}

func (c *Client) IsHealthy() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.healthy
}

func (c *Client) Touch() {
	c.mu.Lock()
	c.lastUsed = time.Now()
	c.mu.Unlock()
}

func (c *Client) LastUsed() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastUsed
}

type JSONRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      float64     `json:"id"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
}

type CallParams struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments,omitempty"`
}

type JSONRPCResponse struct {
	JSONRPC string        `json:"jsonrpc"`
	ID      float64       `json:"id"`
	Result  interface{}   `json:"result,omitempty"`
	Error   *JSONRPCError `json:"error,omitempty"`
}

type JSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    string `json:"data,omitempty"`
}

func (c *Client) CallTool(ctx context.Context, tool string, params map[string]interface{}) (interface{}, error) {
	c.Touch()

	if params == nil {
		params = make(map[string]interface{})
	}

	for k, v := range params {
		switch s := v.(type) {
		case string:
			lower := strings.ToLower(strings.TrimSpace(s))
			if lower == "true" {
				params[k] = true
			} else if lower == "false" {
				params[k] = false
			} else {
				params[k] = sanitizeStringParam(s)
			}
		}
	}
	fmt.Printf("🔧 MCP CallTool - Tool: %s, Params: %+v\n", tool, params)

	rpcID := float64(time.Now().UnixNano()) / 1e9

	for k, v := range params {
		if s, ok := v.(string); ok {
			params[k] = sanitizeStringParam(s)
		}
	}

	reqBody := JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      rpcID,
		Method:  "tools/call",
		Params:  CallParams{Name: tool, Arguments: params},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal call: %w", err)
	}
	fmt.Printf("🔧 MCP Request Body: %s\n", string(body))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint+"/mcp", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mcp call failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read mcp body: %w", err)
	}

	fmt.Printf("🔧 MCP Response Status: %d\n", resp.StatusCode)
	fmt.Printf("🔧 MCP Response Body: %s\n", string(raw))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("mcp status %d: %s", resp.StatusCode, string(raw))
	}

	var rpcResp JSONRPCResponse
	if err := json.Unmarshal(raw, &rpcResp); err != nil {
		return nil, fmt.Errorf("unmarshal mcp response: %w", err)
	}

	if rpcResp.Error != nil {
		return nil, fmt.Errorf("mcp error [%d]: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}

	// Parse the result to extract the actual data
	return extractResult(rpcResp.Result), nil
}

// extractResult extracts the actual data from the MCP result structure
func extractResult(result interface{}) interface{} {
	// Try to parse as map
	if resultMap, ok := result.(map[string]interface{}); ok {
		// Check if it has a "content" field
		if content, ok := resultMap["content"]; ok {
			if contentSlice, ok := content.([]interface{}); ok && len(contentSlice) > 0 {
				// Look for the first text content
				for _, item := range contentSlice {
					if itemMap, ok := item.(map[string]interface{}); ok {
						if itemType, ok := itemMap["type"]; ok && itemType == "text" {
							if text, ok := itemMap["text"]; ok {
								if textStr, ok := text.(string); ok {
									// Try to parse the text as JSON
									var parsedJSON map[string]interface{}
									if err := json.Unmarshal([]byte(textStr), &parsedJSON); err == nil {
										return parsedJSON
									}
									return textStr
								}
							}
						}
					}
				}
			}
		}
		// If no content field, return the result as-is
		return resultMap
	}
	return result
}

func (c *Client) Close() {
	if c.HTTP != nil {
		c.HTTP.CloseIdleConnections()
	}
}

func sanitizeStringParam(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		var unquoted string
		if err := json.Unmarshal([]byte(s), &unquoted); err == nil {
			return unquoted
		}
		return s[1 : len(s)-1]
	}
	if strings.Contains(s, `\"`) {
		var unquoted string
		if err := json.Unmarshal([]byte(`"`+s+`"`), &unquoted); err == nil {
			return unquoted
		}
		return strings.ReplaceAll(s, `\"`, `"`)
	}
	return s
}
