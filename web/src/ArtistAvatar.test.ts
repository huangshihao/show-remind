import { expect, it } from "vitest";
import { avatarInitial, initialColor } from "./ArtistAvatar";

it("avatarInitial takes the first codepoint, trimming and handling astral chars", () => {
  expect(avatarInitial("  刺猬 ")).toBe("刺");
  expect(avatarInitial("re tros")).toBe("r");
  expect(avatarInitial("🎸 band")).toBe("🎸"); // astral emoji is one codepoint, not two
  expect(avatarInitial("   ")).toBe("?");
});

it("initialColor is deterministic and returns a palette hex", () => {
  expect(initialColor("刺猬")).toBe(initialColor("刺猬"));
  expect(initialColor("海龟先生")).toMatch(/^#[0-9a-f]{6}$/);
});
