import type { ApiErrorResponse, ScanRequest, ScanResponse } from "@wave/api-types";
import { authClient } from "./authClient";

export class ScanError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function submitScan(request: ScanRequest): Promise<ScanResponse> {
  const res = await authClient.authorizedFetch("/buvette/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = (await res.json()) as ScanResponse | ApiErrorResponse;
  if (!res.ok) {
    throw new ScanError(res.status, (body as ApiErrorResponse).error ?? "scan failed");
  }
  return body as ScanResponse;
}
