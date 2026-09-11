export interface Product {
  id: string;
  name: string;
  pricePoints: number;
}

export interface ProductsResponse {
  products: Product[];
}

export interface ScanRequest {
  qrPayload: string;
  productId?: string;
  customAmount?: number;
  quantity?: number;
}

export interface ScanResponse {
  transactionId: string;
  product: Product | null;
  quantity: number | null;
  amountDeducted: number;
  newBalance: number;
  customerUserId: string;
}

export interface ApiErrorResponse {
  error: string;
}
