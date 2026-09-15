import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    // The component test helpers use `import.meta.glob`, which only works
    // when Vite transforms them (i.e. they're inlined, not externalized).
    server: {
      deps: { inline: ["convex-test", "@convex-dev/r2", "@convex-dev/action-retrier"] },
    },
  },
});
