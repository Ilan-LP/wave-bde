import type { Product, ProductsResponse } from "@wave/api-types";
import { authClient } from "./authClient";

export async function fetchProducts(): Promise<Product[]> {
  const res = await authClient.authorizedFetch("/products");
  if (!res.ok) {
    throw new Error("failed to load products");
  }
  const body = (await res.json()) as ProductsResponse;
  return body.products;
}
