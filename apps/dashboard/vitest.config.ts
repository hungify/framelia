import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: { conditions: ["framelia-dev"] },
  ssr: { resolve: { conditions: ["framelia-dev"] } },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
