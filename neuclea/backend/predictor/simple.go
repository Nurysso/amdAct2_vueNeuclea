package predictor

import (
	"math"
	"sort"
	"sync"
	"time"
)

const decayHalfLifeHours = 24.0

type edge struct {
	count     float64 // decayed weight, not raw count
	updatedAt time.Time
}

type Predictor struct {
	mu      sync.RWMutex
	first   map[string]map[string]*edge    // prev -> next -> edge
	second  map[[2]string]map[string]*edge // (prev2,prev1) -> next -> edge
	history []string                       // rolling last-N tool names
}

func New() *Predictor {
	return &Predictor{
		first:  map[string]map[string]*edge{},
		second: map[[2]string]map[string]*edge{},
	}
}

func decayedWeight(e *edge) float64 {
	hours := time.Since(e.updatedAt).Hours()
	return e.count * math.Pow(0.5, hours/decayHalfLifeHours)
}

func recordEdge[K comparable](m map[K]map[string]*edge, from K, to string) {
	row, ok := m[from]
	if !ok {
		row = map[string]*edge{}
		m[from] = row
	}
	e, ok := row[to]
	if !ok {
		e = &edge{}
		row[to] = e
	}
	// carry forward decayed weight before adding 1
	e.count = decayedWeight(e) + 1.0
	e.updatedAt = time.Now()
}

func (p *Predictor) Record(prev, next string) {
	if prev == "" || next == "" || prev == next {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	recordEdge(p.first, prev, next)

	// second-order: need at least 2 history entries
	n := len(p.history)
	if n >= 2 {
		key := [2]string{p.history[n-2], p.history[n-1]}
		recordEdge(p.second, key, next)
	}

	p.history = append(p.history, next)
	if len(p.history) > 20 {
		p.history = p.history[len(p.history)-20:]
	}
}

type scored struct {
	tool  string
	score float64
}

func topN(scores map[string]float64, n int) []string {
	all := make([]scored, 0, len(scores))
	for t, s := range scores {
		all = append(all, scored{t, s})
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].score != all[j].score {
			return all[i].score > all[j].score
		}
		return all[i].tool < all[j].tool
	})
	if n > len(all) {
		n = len(all)
	}
	out := make([]string, n)
	for i := range out {
		out[i] = all[i].tool
	}
	return out
}

// Predict returns up to n predicted next tools for the current tool.
// Second-order signal gets 2x weight over first-order when available.
func (p *Predictor) Predict(current string, n int) []string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	scores := map[string]float64{}

	// first-order
	if row, ok := p.first[current]; ok {
		for t, e := range row {
			scores[t] += decayedWeight(e) * 1.0
		}
	}

	// second-order (higher weight)
	h := p.history
	if len(h) >= 1 {
		prev2 := ""
		if len(h) >= 2 {
			prev2 = h[len(h)-2]
		}
		key := [2]string{prev2, current}
		if row, ok := p.second[key]; ok {
			for t, e := range row {
				scores[t] += decayedWeight(e) * 2.0
			}
		}
	}

	return topN(scores, n)
}

func (p *Predictor) Stats() (transitions int, uniqueFrom int) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	uniqueFrom = len(p.first)
	for _, row := range p.first {
		for _, e := range row {
			transitions += int(math.Round(decayedWeight(e)))
		}
	}
	return
}
