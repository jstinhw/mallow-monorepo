// Shared ESLint flat config for every Node/TypeScript package in the workspace
// (graviton/*, guardian/*, packages/*, sdk). The `wallet` app has its own
// Next.js config that extends the Prettier compatibility layer separately.
//
// Type-aware rules are intentionally left off here to keep linting fast and
// config-free; `tsc --noEmit` (pnpm typecheck) is the type-correctness gate.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "graviton/contracts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Carried over from Graviton's original .eslintrc: `any` is tracked but
      // not blocking, and a leading underscore marks a deliberately unused
      // binding.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Must come last: disables ESLint rules that conflict with Prettier.
  eslintConfigPrettier,
);
