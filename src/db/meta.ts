export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM meta WHERE key=?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(key, value)
    .run();
}

const KEY = "consecutive_full_failures";

export async function bumpConsecutiveFailures(db: D1Database): Promise<number> {
  const n = Number((await getMeta(db, KEY)) ?? "0") + 1;
  await setMeta(db, KEY, String(n));
  return n;
}

export async function resetConsecutiveFailures(db: D1Database): Promise<void> {
  await setMeta(db, KEY, "0");
}
