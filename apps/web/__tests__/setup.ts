import { afterEach } from "vitest"

// Testing Library only auto-cleans when vitest globals are enabled.
afterEach(async () => {
  if (typeof document === "undefined") return
  const { cleanup } = await import("@testing-library/react")
  cleanup()
})
