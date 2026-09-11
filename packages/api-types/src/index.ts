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

export interface ProductAdmin extends Product {
  isActive: boolean;
}

export interface ProductsAllResponse {
  products: ProductAdmin[];
}

export interface CreateProductRequest {
  name: string;
  pricePoints: number;
}

export interface CreateProductResponse {
  product: ProductAdmin;
}

export interface UpdateProductRequest {
  name?: string;
  pricePoints?: number;
}

export interface UpdateProductResponse {
  product: ProductAdmin;
}

export interface SetProductActiveRequest {
  isActive: boolean;
}

export interface SetProductActiveResponse {
  product: ProductAdmin;
}

export interface BalanceResponse {
  balance: number;
}

export interface QrCodeResponse {
  qrPayload: string;
  expiresAt: string;
}

export interface RechargeRequest {
  points: number;
}

export interface RechargeResponse {
  rechargeId: string;
  checkoutId: string;
  hostedCheckoutUrl: string;
  points: number;
  amount: number;
  currency: string;
}

export type RechargeConfirmStatus = "PENDING" | "CONFIRMED" | "FAILED" | "EXPIRED";

export interface RechargeConfirmResponse {
  status: RechargeConfirmStatus;
  points?: number;
  newBalance?: number;
  error?: string;
}
