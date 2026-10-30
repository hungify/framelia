export default {
  "**/*.{js,ts,mjs,cjs,vue}": [
    "oxlint --fix --no-error-on-unmatched-pattern",
    "oxfmt --no-error-on-unmatched-pattern",
  ],
  "**/*.{json,jsonc,yaml,yml,md}": ["oxfmt --no-error-on-unmatched-pattern"],
};
