import { useState, useEffect } from 'react'
import type { Product } from '../types/product'

interface UseProductResult {
  product: Product | null
  loading: boolean
  error: string | null
}

export function useProduct(id: string | undefined): UseProductResult {
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setProduct(null)

    fetch(`/api/products/${id}`)
      .then(res => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Product not found' : `HTTP ${res.status}`)
        return res.json() as Promise<Product>
      })
      .then(data => {
        if (!cancelled) { setProduct(data); setLoading(false) }
      })
      .catch(err => {
        if (!cancelled) { setError(err.message ?? 'Failed to load product'); setLoading(false) }
      })

    return () => { cancelled = true }
  }, [id])

  return { product, loading, error }
}
