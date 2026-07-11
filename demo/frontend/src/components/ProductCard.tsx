import { Link } from 'react-router-dom';
import type { Product } from '../types/product';
import './ProductCard.css';

interface ProductCardProps {
  product: Product;
  index?: number;
}

const CATEGORY_BADGE: Record<string, string> = {
  Electronics: 'badge-teal',
  Clothing: 'badge-amber',
  'Home & Garden': 'badge-success',
  Books: 'badge-ghost',
};

function Stars({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  return (
    <span className="stars" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ opacity: i < full ? 1 : half && i === full ? 0.5 : 0.2 }}>
          ★
        </span>
      ))}
      <span
        className="card-rating-value text-tertiary tabular"
        style={{ fontFamily: 'var(--font-mono)', marginLeft: 4 }}
      >
        {rating.toFixed(1)}
      </span>
    </span>
  );
}

export function ProductCard({ product, index = 0 }: ProductCardProps) {
  const badgeClass = CATEGORY_BADGE[product.category] ?? 'badge-ghost';

  return (
    <Link
      to={`/products/${product.id}`}
      className="product-card"
      style={{ animationDelay: `${index * 40}ms` }}
      aria-label={`View ${product.name}`}
    >
      {/* Image */}
      <div className="card-image-wrap">
        <img
          src={product.image_url}
          alt={product.name}
          className="card-image"
          loading="lazy"
          width="600"
          height="400"
        />
        <span className={`badge ${badgeClass} card-category`}>{product.category}</span>
      </div>

      {/* Body */}
      <div className="card-body">
        <h3 className="card-name">{product.name}</h3>
        <p className="card-desc">{product.description.slice(0, 90)}…</p>

        <div className="card-meta">
          <Stars rating={product.rating} />
          <span className="card-stock text-tertiary">
            {product.stock > 0 ? (
              <span className="text-secondary">{product.stock} left</span>
            ) : (
              <span className="text-error">Out of stock</span>
            )}
          </span>
        </div>

        <div className="card-footer-row">
          <span className="card-price tabular font-mono">${product.price.toFixed(2)}</span>
          <span className="card-cta btn btn-primary btn-sm">View →</span>
        </div>
      </div>

      {/* This strip visualises exactly what agents.json tells an agent to grab. */}
      {/* <div className="code-strip card-json-strip" aria-hidden="true">
        <span className="punct">{'{'}</span>
        <span className="key">"id"</span>
        <span className="punct">:</span>
        <span className="value">{product.id}</span>
        <span className="punct">,</span>
        <span className="key">"price"</span>
        <span className="punct">:</span>
        <span className="value">{product.price.toFixed(2)}</span>
        <span className="punct">,</span>
        <span className="key">"category"</span>
        <span className="punct">:</span>
        <span className="value">"{product.category}"</span>
        <span className="punct">{'}'}</span>
      </div> */}
    </Link>
  );
}
