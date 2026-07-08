import { useState, useMemo } from 'react'
import { useProducts } from '../hooks/useProducts'
import { ProductCard } from '../components/ProductCard'
import { CategoryFilter } from '../components/CategoryFilter'
import { LoadingGrid } from '../components/LoadingGrid'
import './ProductsPage.css'

export function ProductsPage() {
  const [activeCategory, setActiveCategory] = useState('All')
  const { products, total, loading, error } = useProducts({
    category: activeCategory === 'All' ? undefined : activeCategory,
    limit: 100,
  })

  // Build category counts from all products for filter display
  const { products: allProducts } = useProducts({ limit: 100 })
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    allProducts.forEach(p => { c[p.category] = (c[p.category] ?? 0) + 1 })
    return c
  }, [allProducts])

  return (
    <main className="page">
      <div className="container">
        {/* Page header */}
        <header className="page-header products-header">
          <div>
            <h1>Products</h1>
            <p>
              {loading ? 'Loading…' : `${total} product${total !== 1 ? 's' : ''}`}
              {activeCategory !== 'All' ? ` in ${activeCategory}` : ''}
            </p>
          </div>

          <div className="products-agent-hint">
            <span className="badge badge-amber">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
              Agent hint
            </span>
            <code className="text-code products-hint-code">
              GET /api/products?limit=100
            </code>
          </div>
        </header>

        {/* Category filter */}
        <div className="products-filters">
          <CategoryFilter
            active={activeCategory}
            onChange={setActiveCategory}
            counts={counts}
          />
        </div>

        {/* Grid */}
        {error ? (
          <div className="empty-state" role="alert">
            <span className="icon">⚠️</span>
            <h3>Failed to load products</h3>
            <p>{error}</p>
            <p className="text-tertiary">
              Make sure the backend is running at <code className="text-code">http://localhost:8000</code>
            </p>
          </div>
        ) : loading ? (
          <LoadingGrid count={9} />
        ) : products.length === 0 ? (
          <div className="empty-state">
            <span className="icon">🔍</span>
            <h3>No products found</h3>
            <p>Try a different category filter.</p>
          </div>
        ) : (
          <div className="product-grid">
            {products.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
