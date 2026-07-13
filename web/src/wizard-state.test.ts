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

it("toggles and adds manual artists without duplicates", () => {
  let s = wizardReducer(initialWizard(), {
    type: "LOADED_PLAYLIST", title: "x", artists: [{ name: "刺猬", songCount: 1 }],
  });
  s = wizardReducer(s, { type: "TOGGLE_ARTIST", name: "刺猬" });
  expect(selectedArtistNames(s)).toEqual([]);
  s = wizardReducer(s, { type: "ADD_MANUAL", name: "海龟先生" });
  s = wizardReducer(s, { type: "ADD_MANUAL", name: "海龟先生" });
  expect(selectedArtistNames(s)).toEqual(["海龟先生"]);
});
