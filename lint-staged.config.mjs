export default {
  "**/*.{js,ts,mjs,cjs,vue}": ["oxlint --fix", "oxfmt"],
  "**/*.{json,jsonc,yaml,yml,md}": ["oxfmt"],
};
