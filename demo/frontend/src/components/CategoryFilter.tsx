import './CategoryFilter.css'

const CATEGORIES = ['All', 'Electronics', 'Clothing', 'Home & Garden', 'Books'] as const

interface CategoryFilterProps {
  active: string
  onChange: (category: string) => void
  counts?: Record<string, number>
}

export function CategoryFilter({ active, onChange, counts }: CategoryFilterProps) {
  return (
    <div className="category-filter" role="group" aria-label="Filter by category">
      {CATEGORIES.map(cat => (
        <button
          key={cat}
          id={`filter-${cat.toLowerCase().replace(/\s+/g, '-')}`}
          className={`category-pill ${active === cat ? 'is-active' : ''}`}
          onClick={() => onChange(cat)}
          aria-pressed={active === cat}
        >
          {cat}
          {counts && cat !== 'All' && counts[cat] !== undefined && (
            <span className="category-pill-count">{counts[cat]}</span>
          )}
          {counts && cat === 'All' && (
            <span className="category-pill-count">{Object.values(counts).reduce((a, b) => a + b, 0)}</span>
          )}
        </button>
      ))}
    </div>
  )
}
