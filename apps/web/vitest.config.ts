import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    // Pure logic tests run in node; UI tests opt into jsdom with a
    // `// @vitest-environment jsdom` docblock.
    environment: "node",
    setupFiles: ["./__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
})
