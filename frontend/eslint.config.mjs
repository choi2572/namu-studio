import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import sonarjs from "eslint-plugin-sonarjs";

/** Sonar recommended는 React/앱 코드에 과하게 엄격한 규칙이 많아, 우선 warn으로 둔다. */
const sonarRelaxed = {
  rules: {
    "sonarjs/no-nested-conditional": "warn",
    "sonarjs/cognitive-complexity": "warn",
    "sonarjs/no-nested-functions": "warn",
    "sonarjs/no-nested-template-literals": "warn",
    "sonarjs/no-dead-store": "warn",
    "sonarjs/void-use": "warn",
    "sonarjs/slow-regex": "warn",
    "sonarjs/concise-regex": "warn",
    "sonarjs/no-all-duplicated-branches": "warn",
    "sonarjs/no-duplicated-branches": "warn",
    "sonarjs/use-type-alias": "warn",
    "sonarjs/todo-tag": "warn",
    "sonarjs/pseudo-random": "warn",
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/preserve-manual-memoization": "warn",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_"
      }
    ]
  }
};

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  sonarjs.configs.recommended,
  sonarRelaxed,
  eslintConfigPrettier,
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts"
  ])
]);
