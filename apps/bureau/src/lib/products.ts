import type {
  ApiErrorResponse,
  CreateProductRequest,
  CreateProductResponse,
  ProductAdmin,
  ProductsAllResponse,
  SetProductActiveRequest,
  SetProductActiveResponse,
  UpdateProductRequest,
  UpdateProductResponse,
} from "@wave/api-types";
import { authClient } from "./authClient";

export class ProductsError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok) {
    throw new ProductsError(res.status, (body as ApiErrorResponse).error ?? "request failed");
  }
  return body as T;
}

export async function fetchAllProducts(): Promise<ProductAdmin[]> {
  const res = await authClient.authorizedFetch("/products/all");
  const body = await parseOrThrow<ProductsAllResponse>(res);
  return body.products;
}

export async function createProduct(request: CreateProductRequest): Promise<ProductAdmin> {
  const res = await authClient.authorizedFetch("/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await parseOrThrow<CreateProductResponse>(res);
  return body.product;
}

export async function updateProduct(id: string, request: UpdateProductRequest): Promise<ProductAdmin> {
  const res = await authClient.authorizedFetch(`/products/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await parseOrThrow<UpdateProductResponse>(res);
  return body.product;
}

export async function setProductActive(id: string, request: SetProductActiveRequest): Promise<ProductAdmin> {
  const res = await authClient.authorizedFetch(`/products/${id}/active`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await parseOrThrow<SetProductActiveResponse>(res);
  return body.product;
}
