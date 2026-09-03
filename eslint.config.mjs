import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const frontendApps = [
  "apps/bureau",
  "apps/buvette",
  "apps/pole-comm",
  "apps/pole-events",
  "apps/pole-partenariats",
  "apps/showcase",
];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/backend/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: frontendApps.map((app) => `${app}/**/*.{ts,tsx}`),
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ["packages/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
