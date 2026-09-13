/** @type {import('tailwindcss').Config} */
// NOTE: no Wave brand colors were found documented anywhere in this repo.
// Using Tailwind defaults for now — replace `theme.extend.colors.wave` with
// the real BDE Wave palette once it's provided.
//
// NOTE: this preset intentionally does NOT declare a `content` array to
// scan packages/ui/src (so this package's Button/Banner color-variant
// classes get generated). Tailwind v3 presets: `content` REPLACES rather
// than merges across presets + config, so a consuming app's own
// `content` array always wins and a preset-level `content` here would be
// silently discarded — it can't be hoisted this way. Every app under
// apps/* must add "../../packages/ui/src/**/*.{ts,tsx}" to its OWN
// tailwind.config.ts `content` array (see apps/showcase, apps/bureau,
// apps/buvette for the exact entry) — see CLAUDE.md.
export default {
  theme: {
    extend: {
      colors: {
        wave: {
          DEFAULT: "#4f46e5",
        },
      },
    },
  },
};
