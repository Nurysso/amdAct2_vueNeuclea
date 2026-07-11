package mcp

import (
	"context"
	"fmt"
	"sync"
	"time"
)

type Pool struct {
	mu      sync.RWMutex
	clients map[string]*Client // key = endpoint URL
}

func NewPool() *Pool {
	return &Pool{clients: map[string]*Client{}}
}

func (p *Pool) CallTool(ctx context.Context, endpoint string, tool string, params map[string]interface{}) (interface{}, error) {
	c := p.Get(endpoint)
	if c == nil {
		return nil, fmt.Errorf("no mcp client for endpoint %q", endpoint)
	}
	return c.CallTool(ctx, tool, params)
}
func (p *Pool) Add(endpoint string) *Client {
	p.mu.Lock()
	defer p.mu.Unlock()
	if c, ok := p.clients[endpoint]; ok {
		return c
	}
	c := NewClient(endpoint)
	p.clients[endpoint] = c
	return c
}

func (p *Pool) Get(endpoint string) *Client {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.clients[endpoint]
}

func (p *Pool) All() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]string, 0, len(p.clients))
	for k := range p.clients {
		out = append(out, k)
	}
	return out
}

func (p *Pool) HealthCheck(ctx context.Context) error {
	p.mu.RLock()
	clients := make([]*Client, 0, len(p.clients))
	for _, c := range p.clients {
		clients = append(clients, c)
	}
	p.mu.RUnlock()

	for _, c := range clients {
		if err := c.Health(ctx); err != nil {
			return fmt.Errorf("health %s: %w", c.Endpoint, err)
		}
	}
	return nil
}

func (p *Pool) Prewarm(endpoints []string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		for _, ep := range endpoints {
			if c := p.Get(ep); c != nil {
				_ = c.Health(ctx)
			}
		}
	}()
}

func (p *Pool) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, c := range p.clients {
		c.Close()
	}
	p.clients = map[string]*Client{}
}
