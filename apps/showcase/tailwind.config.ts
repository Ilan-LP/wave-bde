import type { Config } from "tailwindcss";
import wavePreset from "@wave/ui/tailwind.preset";

export default {
  presets: [wavePreset],
  // Includes packages/ui/src so Tailwind's content scanner sees the
  // color-variant classes Banner/Button use (bg-red-50, text-green-800,
  // etc.) — without this they're never generated, since those classnames
  // never appear in this app's own src (pre-existing gap in every frontend's
  // tailwind.config.ts; fixed here only, since it directly breaks the
  // profil tab's success/failure feedback — see CLAUDE.md).
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
} satisfies Config;
