import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import vitest from "@vitest/eslint-plugin";
import { defineConfigWithVueTs, vueTsConfigs } from "@vue/eslint-config-typescript";
import prettierConfig from "eslint-config-prettier/flat";
import oxlint from "eslint-plugin-oxlint";
import playwright from "eslint-plugin-playwright";
import { configs as regexpConfigs } from "eslint-plugin-regexp";
import pluginVue from "eslint-plugin-vue";
import vueA11y from "eslint-plugin-vuejs-accessibility";

// ESLint covers what Oxlint cannot yet: Vue templates and accessibility, Vitest/Playwright test
// structure, regex correctness and disable-comment hygiene. Everything Oxlint already checks is
// switched off at the end, so `pnpm lint` runs Oxlint first and this second.
export default defineConfigWithVueTs(
  {
    name: "framelia/files-to-lint",
    files: ["**/*.{ts,mts,cts,vue}"],
  },
  // Oxlint reads the same `eslint-disable` comments; the rules they name are switched off here (see
  // the end of this file), so ESLint would wrongly report them as unused.
  {
    name: "framelia/linter-options",
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  {
    name: "framelia/files-to-ignore",
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.stryker-tmp/**",
      "**/reports/**",
      "**/test-results/**",
      ".agents/**",
      ".claude/**",
      "apps/dashboard/auto-imports.d.ts",
      "apps/dashboard/components.d.ts",
      "apps/dashboard/typed-router.d.ts",
    ],
  },

  pluginVue.configs["flat/recommended"],
  vueTsConfigs.recommended,

  {
    name: "framelia/typescript",
    rules: {
      // TypeScript policy beyond type safety is Oxlint's (`.oxlintrc.json`); `any` is reviewed there.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // Dashboard components: explicit contracts and no dead template code.
  {
    name: "framelia/vue",
    files: ["apps/dashboard/**/*.vue"],
    rules: {
      "vue/multi-word-component-names": ["error", { ignores: ["App"] }],
      "vue/component-name-in-template-casing": [
        "error",
        "PascalCase",
        { registeredComponentsOnly: false },
      ],
      "vue/match-component-file-name": ["error", { extensions: ["vue"], shouldMatchCase: true }],
      "vue/custom-event-name-casing": ["error", "camelCase"],
      "vue/no-unused-properties": ["error", { groups: ["props", "data", "computed", "methods"] }],
      "vue/no-unused-refs": "error",
      "vue/no-unused-emit-declarations": "error",
      "vue/prefer-use-template-ref": "error",
      "vue/require-explicit-slots": "error",
    },
  },
  {
    name: "framelia/vue-pages",
    files: ["apps/dashboard/pages/**/*.vue"],
    rules: { "vue/multi-word-component-names": "off" },
  },
  // Accessibility. Rules only: the preset's own languageOptions would replace the vue-ts parser.
  {
    name: "framelia/a11y",
    files: ["apps/dashboard/**/*.vue"],
    plugins: { "vuejs-accessibility": vueA11y },
    rules: {
      ...Object.fromEntries(
        vueA11y.configs["flat/recommended"].flatMap((config) => Object.entries(config.rules ?? {})),
      ),
      // Nuxt UI form controls render the native input the label wraps.
      "vuejs-accessibility/label-has-for": [
        "error",
        {
          controlComponents: ["USlider", "UCheckbox", "UInput", "USelect", "USwitch"],
          required: { some: ["nesting", "id"] },
        },
      ],
    },
  },

  // Vitest: consistent structure and the most specific matcher.
  {
    ...vitest.configs.recommended,
    name: "framelia/vitest",
    files: ["**/*.test.ts"],
  },
  {
    name: "framelia/vitest-style",
    files: ["**/*.test.ts"],
    rules: {
      "vitest/consistent-test-it": ["error", { fn: "it" }],
      // Hook order and count stay free: each cleanup hook sits next to the resource it releases
      // (`const browser = await chromium.launch(); afterAll(() => browser.close());`).
      "vitest/prefer-hooks-on-top": "error",
      "vitest/prefer-to-be": "error",
      "vitest/prefer-to-have-length": "error",
      "vitest/prefer-to-contain": "error",
      // Test-local components defined with defineComponent().
      "vue/one-component-per-file": "off",
    },
  },

  // Playwright smoke suites and consumer specs.
  {
    name: "framelia/playwright",
    files: ["packages/playwright/tests-smoke*/**/*.ts", "scripts/consumer-smoke/**/*.spec.ts"],
    plugins: { playwright },
    rules: {
      ...Object.fromEntries(
        Object.keys(playwright.configs["flat/recommended"].rules ?? {})
          .filter((rule) => rule.startsWith("playwright/"))
          .map((rule) => [rule, "error"]),
      ),
      // defineFigmaTests() runs `prepare` inside each generated test, and consumer specs assert on
      // contracts at collection time; neither is a standalone expect.
      "playwright/no-standalone-expect": "off",
    },
  },

  // Regex correctness: contracts and capture rules lean on regexes (ids, Figma node ids, paths).
  {
    ...regexpConfigs["flat/recommended"],
    files: ["**/*.{ts,mts,cts,vue}"],
  },
  {
    name: "framelia/regexp-overrides",
    files: ["**/*.{ts,mts,cts,vue}"],
    rules: {
      // Contract schemas export their regexes as JSON Schema `pattern`s, which have no flags and
      // read more plainly with explicit ranges than `\w`.
      "regexp/use-ignore-case": "off",
      "regexp/prefer-w": "off",
    },
  },

  // A disable comment must name its rule and say why.
  {
    name: "framelia/eslint-comments",
    files: ["**/*.{ts,mts,cts,vue}"],
    plugins: { "@eslint-community/eslint-comments": eslintComments },
    rules: {
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/require-description": "error",
    },
  },

  {
    name: "framelia/declaration-files",
    files: ["**/*.d.ts"],
    rules: { "@typescript-eslint/no-empty-object-type": "off" },
  },

  // Disable ESLint rules already covered by Oxlint (must come last).
  ...oxlint.buildFromOxlintConfigFile("./.oxlintrc.json"),
  // Oxfmt formats; turn off the stylistic rules that would fight it.
  prettierConfig,
);
