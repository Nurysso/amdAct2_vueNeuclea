import './LoadingGrid.css'

export function LoadingGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="product-grid" aria-busy="true" aria-label="Loading products">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="loading-card">
          <div className="skeleton loading-card-image" />
          <div className="loading-card-body">
            <div className="skeleton loading-card-title" />
            <div className="skeleton loading-card-desc" />
            <div className="skeleton loading-card-desc" style={{ width: '60%' }} />
            <div className="loading-card-footer">
              <div className="skeleton loading-card-price" />
              <div className="skeleton loading-card-btn" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
