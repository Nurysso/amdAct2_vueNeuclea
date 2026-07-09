package handlers

import "encoding/json"

type AgentsConfig struct {
	SchemaVersion string       `json:"schema_version"`
	Name          string       `json:"name"`
	Description   string       `json:"description"`
	MCPServerURL  string       `json:"mcp_server_url"`
	Environment   string       `json:"environment"`
	Auth          AuthConfig   `json:"auth"`
	Capabilities  Capabilities `json:"capabilities"`
	RateLimits    RateLimits   `json:"rate_limits"`
	ToolGroups    []ToolGroup  `json:"tool_groups"`
	Tools         []Tool       `json:"tools"`
}

type AuthConfig struct {
	Type             string   `json:"type"`
	AuthorizationURL string   `json:"authorization_url,omitempty"`
	TokenURL         string   `json:"token_url,omitempty"`
	Scopes           []string `json:"scopes,omitempty"`
	HeaderName       string   `json:"header_name,omitempty"`
}

type Capabilities struct {
	Streaming          bool `json:"streaming"`
	BatchCalls         bool `json:"batch_calls"`
	MaxConcurrentTools int  `json:"max_concurrent_tools"`
}

type RateLimits struct {
	RequestsPerMinute int `json:"requests_per_minute"`
	RequestsPerDay    int `json:"requests_per_day"`
}

type ToolGroup struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Tools       []string `json:"tools"`
}

type Tool struct {
	Name         string     `json:"name"`
	Group        string     `json:"group"`
	Description  string     `json:"description"`
	InputSchema  JSONSchema `json:"input_schema"`
	OutputSchema JSONSchema `json:"output_schema,omitempty"`
	AuthRequired bool       `json:"auth_required"`
	ReadOnly     bool       `json:"read_only"`
}

type JSONSchema struct {
	Type       string              `json:"type"`
	Required   []string            `json:"required,omitempty"`
	Properties map[string]Property `json:"properties,omitempty"`
	Items      *JSONSchema         `json:"items,omitempty"`
	Default    interface{}         `json:"default,omitempty"`
	Minimum    *int                `json:"minimum,omitempty"`
	Maximum    *int                `json:"maximum,omitempty"`
	Enum       []string            `json:"enum,omitempty"`
}

type Property struct {
	Type        string      `json:"type"`
	Description string      `json:"description,omitempty"`
	Default     interface{} `json:"default,omitempty"`
	Minimum     *int        `json:"minimum,omitempty"`
	Maximum     *int        `json:"maximum,omitempty"`
	Items       *JSONSchema `json:"items,omitempty"`
}

func UnmarshalAgentsConfig(raw []byte) (*AgentsConfig, error) {
	var c AgentsConfig
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	return &c, nil
}
