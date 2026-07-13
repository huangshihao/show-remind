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
      },
    }),
  ],
  test: {
    // Scoped to `test/**` only: the pre-existing `lib/**/*.test.ts` suite
    // (netease/qq/matcher/etc.) was written for the old Node+Prisma vitest
    // setup (path alias `@/*`, `lib/db` Prisma client) and is not compatible
    // with the workers-pool sandbox as-is (12 of 24 files fail with
    // "Cannot find package '@/lib/db'" — no `@` alias is configured here,
    // and some of those modules depend on Node/Prisma APIs unavailable in
    // the Workers runtime). Reconciling that suite with this pool is a later
    // task's job (see task-2-report.md).
    include: ["test/**/*.test.ts"],
  },
});
