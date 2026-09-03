/** @type {import('tailwindcss').Config} */
// NOTE: no Wave brand colors were found documented anywhere in this repo.
// Using Tailwind defaults for now — replace `theme.extend.colors.wave` with
// the real BDE Wave palette once it's provided.
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
