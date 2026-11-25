import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@/app": path.resolve(__dirname, "app"),
      "@/server": path.resolve(__dirname, "server"),
      "@/lib": path.resolve(__dirname, "../web/lib"),
    },
  },
})
