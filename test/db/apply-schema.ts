/// <reference types="vite/client" />
import { env } from "cloudflare:test";
// The workers-pool test runner executes this file inside the sandboxed
// Workers runtime (workerd), which has no access to the real host filesystem
// via `node:fs` (readFileSync/existsSync against host paths silently fail as
// ENOENT there, even with `nodejs_compat`). So instead of reading schema.sql
// at runtime, we let Vite inline its contents as a string at bundle time.
// See task-2-report.md for details on why this differs from the brief.
import schemaSql from "../../src/db/schema.sql?raw";

// Split schema.sql into statements and execute against the isolated test D1.
export async function applySchema(): Promise<void> {
  // Drop tables in reverse dependency order to clear state between tests
  const tableOrder = [
    "show_artists",
    "subscription_artists",
    "notifications",
    "shows",
    "artists",
    "subscriptions",
    "meta",
  ];
  for (const table of tableOrder) {
    await env.DB.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  }

  const statements = schemaSql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
  await env.DB.prepare("PRAGMA foreign_keys = ON").run();
}
