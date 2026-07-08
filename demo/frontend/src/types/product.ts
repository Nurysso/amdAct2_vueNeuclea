export interface Product {
  id: number
  slug: string
  name: string
  price: number
  category: string
  image_url: string
  description: string
  rating: number
  stock: number
  tags: string[]
}

export interface ProductListResponse {
  data: Product[]
  total: number
  page: number
  limit: number
  total_pages: number
}

export type Category = 'Electronics' | 'Clothing' | 'Home & Garden' | 'Books' | 'All'
