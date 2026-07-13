import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// NOTE: the installed @cloudflare/vitest-pool-workers (0.18.4) targets vitest 4
// and dropped the old `defineWorkersConfig`/"@cloudflare/vitest-pool-workers/config"
// API in favor of a Vite plugin. Same effective config (wrangler configPath +
// miniflare d1Databases binding), just expressed through `cloudflareTest()`.
// See task-2-report.md for details.
export default defineConfig({
  // Mirror tsconfig's `@/*` -> repo-root path alias so `src/` modules can
  // import pure `lib/` code (e.g. `@/lib/matcher/normalize`) under the
  // workers-pool runtime. The `"@"` string alias only matches `@/...`
  // (not `@cloudflare/...`), so it is safe.
  resolve: { alias: { "@": import.meta.dirname } },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // apply schema to the isolated test D1 before each file
        d1Databases: { DB: "show-remind" },
        // vars/secrets the Worker's Env expects (src/env.ts) — populated here
        // so routes that read c.env.* (turnstile, mail, limits, PUBLIC_MODE
        // gating) have stable values under test.
        bindings: {
          APP_BASE_URL: "https://test.local",
          INTERNAL_SECRET: "test-internal",
          RESEND_API_KEY: "",
          MAIL_FROM: "Show <n@test.local>",
          ADMIN_EMAIL: "admin@test.local",
          TURNSTILE_SECRET: "test-turnstile",
          TURNSTILE_SITE_KEY: "",
          PUBLIC_MODE: "0",
        },
      },
    }),
  ],
  test: {
    // Server + pure-lib tests run in the workers pool. `test/**` covers the
    // Worker routes/pipeline/db; `lib/**` covers the reverse-engineered
    // source/adapter fixture tests (netease/qq/showstart/matcher) — these are
    // the early-warning guard for upstream API drift, so they must run under
    // `pnpm test`. (The old Prisma-dependent lib tests that couldn't run here
    // were deleted with the rest of the Prisma stack in the cleanup task.)
    // The React SPA tests run separately under vitest.web.config.ts (happy-dom).
    include: ["test/**/*.test.ts", "lib/**/*.test.ts"],
  },
});
