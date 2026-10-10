import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";

export default defineConfig([
  { ignores: ["node_modules/**", "dist/**", "main.js", "*.mjs"] },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        sourceType: "module",
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", {
        brands: [...DEFAULT_BRANDS, "Omni Book Reader", "ePub Reader"],
        acronyms: [...DEFAULT_ACRONYMS, "EPUB", "CFI"],
      }],
    },
  },
]);
