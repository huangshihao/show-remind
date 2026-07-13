import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { applySchema } from "./apply-schema";
import {
  createPendingSubscription,
  getByToken,
  getByEmail,
  activateByToken,
  setCities,
  deleteByToken,
} from "../../src/db/subscriptions";

beforeEach(applySchema);
const db = () => env.DB;

it("creates a pending subscription and reads it back", async () => {
  const sub = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  expect(sub.status).toBe("pending");
  expect(sub.cities).toEqual(["110000"]);
  expect(sub.token).toMatch(/^[0-9a-f]{64}$/);
  expect((await getByEmail(db(), "a@b.com"))?.id).toBe(sub.id);
  expect((await getByToken(db(), sub.token))?.id).toBe(sub.id);
});

it("re-subscribe with same email keeps token, updates cities, resets to pending", async () => {
  const first = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  await activateByToken(db(), first.token);
  const again = await createPendingSubscription(db(), "a@b.com", ["310000"]);
  expect(again.id).toBe(first.id);
  expect(again.token).toBe(first.token);
  expect(again.cities).toEqual(["310000"]);
  expect(again.status).toBe("pending");
});

it("activateByToken flips status and reports match", async () => {
  const sub = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  expect(await activateByToken(db(), sub.token)).toBe(true);
  expect((await getByToken(db(), sub.token))?.status).toBe("active");
  expect(await activateByToken(db(), "nope")).toBe(false);
});

it("setCities updates the json array", async () => {
  const sub = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  await setCities(db(), sub.id, ["110000", "310000"]);
  expect((await getByToken(db(), sub.token))?.cities).toEqual(["110000", "310000"]);
});

it("deleteByToken removes the row", async () => {
  const sub = await createPendingSubscription(db(), "a@b.com", ["110000"]);
  expect(await deleteByToken(db(), sub.token)).toBe(true);
  expect(await getByToken(db(), sub.token)).toBeNull();
});
