import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import js from "@eslint/js";
import globals from "globals";

export default ts.config(
  { ignores: ["dist/**", "node_modules/**", "src/api.generated.ts"] },
  {
    ...js.configs.recommended,
    files: ["**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  ...ts.configs.recommended.map((config) => ({
    ...config,
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "*.config.ts"],
  })),
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
);
