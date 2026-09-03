import type { Config } from "tailwindcss";
import wavePreset from "@wave/ui/tailwind.preset";

export default {
  presets: [wavePreset],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
} satisfies Config;
