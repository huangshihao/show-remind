import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["web/**/*.test.ts", "web/**/*.test.tsx"],
    environment: "happy-dom",
  },
});
