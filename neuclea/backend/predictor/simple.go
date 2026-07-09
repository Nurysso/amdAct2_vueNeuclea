package predictor

import (
	"sort"
	"sync"
)

type Predictor struct {
	mu     sync.RWMutex
	counts map[string]map[string]int // from -> to -> count
}

func New() *Predictor {
	return &Predictor{counts: map[string]map[string]int{}}
}

func (p *Predictor) Record(prev, next string) {
	if prev == "" || next == "" || prev == next {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	row, ok := p.counts[prev]
	if !ok {
		row = map[string]int{}
		p.counts[prev] = row
	}
	row[next]++
}

func (p *Predictor) Predict(current string, n int) []string {
	p.mu.RLock()
	defer p.mu.RUnlock()
	row, ok := p.counts[current]
	if !ok {
		return nil
	}
	type kv struct {
		tool  string
		count int
	}
	all := make([]kv, 0, len(row))
	for t, c := range row {
		all = append(all, kv{t, c})
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].count != all[j].count {
			return all[i].count > all[j].count
		}
		return all[i].tool < all[j].tool
	})
	if n > len(all) {
		n = len(all)
	}
	out := make([]string, n)
	for i := 0; i < n; i++ {
		out[i] = all[i].tool
	}
	return out
}

func (p *Predictor) Stats() (transitions int, uniqueFrom int) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	uniqueFrom = len(p.counts)
	for _, row := range p.counts {
		transitions += rowTotal(row)
	}
	return
}

func rowTotal(row map[string]int) int {
	t := 0
	for _, v := range row {
		t += v
	}
	return t
}
