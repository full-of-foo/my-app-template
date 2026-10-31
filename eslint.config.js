import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-mobile/**",
      "android/**",
      "ios/**",
      ".mobile-artifacts/**",
      "ios/App/CapApp-SPM/**",
      "coverage/**",
      "coverage-server/**",
      "playwright-report/**",
      "test-results/**",
      "test-results-live/**",
      "reports/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": hooks, "jsx-a11y": jsxA11y },
    rules: {
      ...hooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      // Labelled overflow regions need keyboard focus for horizontal scrolling.
      "jsx-a11y/no-noninteractive-tabindex": [
        "error",
        { roles: ["tabpanel", "region"] },
      ],
    },
  },
);
