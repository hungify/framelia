export default {
  "**/*.{js,ts,mjs,cjs,vue}": ["oxlint --fix", "oxfmt"],
  "**/*.{ts,mts,cts,vue}": ["eslint --fix --no-warn-ignored"],
  "**/*.{json,jsonc,yaml,yml,md}": ["oxfmt"],
};
