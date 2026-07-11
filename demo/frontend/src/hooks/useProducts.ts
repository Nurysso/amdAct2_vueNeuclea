import { useEffect, useState } from 'react';
import type { Product, ProductListResponse } from '../types/product';

interface UseProductsOptions {
  category?: string;
  page?: number;
  limit?: number;
}

interface UseProductsResult {
  products: Product[];
  total: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
}

export function useProducts({
  category,
  page = 1,
  limit = 100,
}: UseProductsOptions = {}): UseProductsResult {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (category && category !== 'All') params.set('category', category);
    params.set('page', String(page));
    params.set('limit', String(limit));

    const url = `${baseUrl}/api/products?${params}`;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<ProductListResponse>;
      })
      .then((data) => {
        if (!cancelled) {
          setProducts(data.data);
          setTotal(data.total);
          setTotalPages(data.total_pages);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message ?? 'Failed to load products');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [category, page, limit, baseUrl]);

  return { products, total, totalPages, loading, error };
}
