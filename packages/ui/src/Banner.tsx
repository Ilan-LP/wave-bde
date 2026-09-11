import type { ReactNode } from "react";

export type BannerVariant = "success" | "error" | "info";

export interface BannerProps {
  variant: BannerVariant;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<BannerVariant, string> = {
  success: "bg-green-50 text-green-800 border-green-200",
  error: "bg-red-50 text-red-800 border-red-200",
  info: "bg-blue-50 text-blue-800 border-blue-200",
};

export function Banner({ variant, children }: BannerProps) {
  return <div className={`rounded-lg border px-4 py-3 text-sm font-medium ${VARIANT_CLASSES[variant]}`}>{children}</div>;
}
