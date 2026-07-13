import { newId, newToken } from "./ids";

export interface SubscriptionRow {
  id: string;
  email: string;
  token: string;
  status: "pending" | "active";
  cities: string[];
}

interface RawRow {
  id: string;
  email: string;
  token: string;
  status: string;
  cities: string;
}

function toRow(r: RawRow): SubscriptionRow {
  return {
    id: r.id,
    email: r.email,
    token: r.token,
    status: r.status === "active" ? "active" : "pending",
    cities: JSON.parse(r.cities) as string[],
  };
}

export async function getByEmail(db: D1Database, email: string): Promise<SubscriptionRow | null> {
  const r = await db.prepare("SELECT * FROM subscriptions WHERE email = ?").bind(email).first<RawRow>();
  return r ? toRow(r) : null;
}

export async function getByToken(db: D1Database, token: string): Promise<SubscriptionRow | null> {
  const r = await db.prepare("SELECT * FROM subscriptions WHERE token = ?").bind(token).first<RawRow>();
  return r ? toRow(r) : null;
}

export async function createPendingSubscription(
  db: D1Database,
  email: string,
  cities: string[],
): Promise<SubscriptionRow> {
  const existing = await getByEmail(db, email);
  const citiesJson = JSON.stringify(cities);
  if (existing) {
    await db
      .prepare("UPDATE subscriptions SET status='pending', cities=? WHERE id=?")
      .bind(citiesJson, existing.id)
      .run();
    return { ...existing, status: "pending", cities };
  }
  const id = newId();
  const token = newToken();
  await db
    .prepare("INSERT INTO subscriptions (id, email, token, status, cities) VALUES (?, ?, ?, 'pending', ?)")
    .bind(id, email, token, citiesJson)
    .run();
  return { id, email, token, status: "pending", cities };
}

export async function activateByToken(db: D1Database, token: string): Promise<boolean> {
  const res = await db
    .prepare("UPDATE subscriptions SET status='active', confirmed_at=datetime('now') WHERE token=?")
    .bind(token)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function setCities(db: D1Database, subscriptionId: string, cities: string[]): Promise<void> {
  await db
    .prepare("UPDATE subscriptions SET cities=? WHERE id=?")
    .bind(JSON.stringify(cities), subscriptionId)
    .run();
}

export async function deleteByToken(db: D1Database, token: string): Promise<boolean> {
  const res = await db.prepare("DELETE FROM subscriptions WHERE token=?").bind(token).run();
  return (res.meta.changes ?? 0) > 0;
}
