package intent

import (
	"strings"
)

type Intent struct {
	Category    string `json:"category"`
	TokenBudget int    `json:"token_budget"`
}

var keywordMap = []struct {
	Category string
	Keywords []string
}{
	{"products", []string{"list products", "show products", "all products", "products in", "product catalog"}},
	{"categories", []string{"categories", "category", "list categories", "show categories", "all categories"}},
	{"order", []string{"order", "buy", "purchase", "checkout", "place an order", "ship"}},
	{"complaint", []string{"complain", "complaint", "refund", "issue", "problem", "broken", "wrong", "angry"}},
	{"email", []string{"email", "send mail", "write an email", "draft email", "reply to", "gmail"}},
	{"track", []string{"track", "tracking", "where is", "shipment status", "delivery status", "package"}},
	{"search", []string{"search", "find", "look up", "look for", "locate", "query for"}},
}

var tokenBudgets = map[string]int{
	"products":   300,
	"categories": 200,
	"order":      500,
	"complaint":  400,
	"email":      600,
	"track":      200,
	"search":     300,
	"general":    250,
}

func Classify(query string) Intent {
	lower := strings.ToLower(query)
	for _, entry := range keywordMap {
		for _, kw := range entry.Keywords {
			if strings.Contains(lower, kw) {
				return Intent{
					Category:    entry.Category,
					TokenBudget: tokenBudgets[entry.Category],
				}
			}
		}
	}
	return Intent{
		Category:    "general",
		TokenBudget: tokenBudgets["general"],
	}
}
