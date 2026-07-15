import { expect, it } from "vitest";
import { initialWizard, wizardReducer, selectedArtistNames } from "./wizard-state";

it("loads a playlist and pre-selects all artists", () => {
  const s = wizardReducer(initialWizard(), {
    type: "LOADED_PLAYLIST",
    title: "My List",
    artists: [{ name: "刺猬", songCount: 3 }, { name: "达达", songCount: 1 }],
  });
  expect(s.title).toBe("My List");
  expect(selectedArtistNames(s).sort()).toEqual(["刺猬", "达达"]);
});

it("preserves avatar urls on loaded artists", () => {
  const s = wizardReducer(initialWizard(), {
    type: "LOADED_PLAYLIST",
    title: "My List",
    artists: [
      { name: "刺猬", songCount: 3, avatar: "https://img/ci.jpg" },
      { name: "达达", songCount: 1, avatar: null },
    ],
  });
  const ci = s.artists.find((a) => a.name === "刺猬");
  const dada = s.artists.find((a) => a.name === "达达");
  expect(ci?.avatar).toBe("https://img/ci.jpg");
  expect(dada?.avatar).toBeNull();
  expect(selectedArtistNames(s).sort()).toEqual(["刺猬", "达达"]);
});

it("toggles artists off and on", () => {
  let s = wizardReducer(initialWizard(), {
    type: "LOADED_PLAYLIST", title: "x", artists: [{ name: "刺猬", songCount: 1 }],
  });
  s = wizardReducer(s, { type: "TOGGLE_ARTIST", name: "刺猬" });
  expect(selectedArtistNames(s)).toEqual([]);
  s = wizardReducer(s, { type: "TOGGLE_ARTIST", name: "刺猬" });
  expect(selectedArtistNames(s)).toEqual(["刺猬"]);
});
