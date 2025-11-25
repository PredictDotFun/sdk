import eslintPluginUnicorn from "eslint-plugin-unicorn";
import { fixupPluginRules } from "@eslint/compat";
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import _import from "eslint-plugin-import";
import simpleImportSort from "eslint-plugin-simple-import-sort";

const compat = new FlatCompat({
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  {
    ignores: ["**/dist", "**/build", "**/docs", "**/*.md", "jest.*", "**/typechain"],
  },
  eslintPluginUnicorn.configs.recommended,
  ...compat.extends(
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ),
  {
    plugins: {
      import: fixupPluginRules(_import),
      "simple-import-sort": simpleImportSort,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    settings: {
      "import/parsers": {
        "@typescript-eslint/parser": [".ts", ".tsx"],
      },
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
        },
      },
    },
    rules: {
      "object-shorthand": "error",
      "import/order": [
        "warn",
        {
          warnOnUnassignedImports: true,
          groups: ["type", "builtin", "external", "parent", "sibling"],
        },
      ],
      "import/first": "error",
      "import/no-duplicates": "error",
      "@typescript-eslint/array-type": [
        "warn",
        {
          default: "generic",
          readonly: "generic",
        },
      ],
      "@typescript-eslint/member-delimiter-style": 0,
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/array-type": "off",
      "unicorn/no-array-reduce": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/switch-case-braces": "off",
      "unicorn/prefer-top-level-await": "off",
      "unicorn/filename-case": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/prefer-bigint-literals": "off",
    },
  },
  {
    files: ["packages/*/src/**/*", "packages/*/test/**/*"],
    rules: {
      "no-console": "error",
    },
  },
];
