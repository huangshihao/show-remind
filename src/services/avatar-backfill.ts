import { setArtistAvatar, setArtistNeteaseId, type ArtistRow } from "../db/artists";
import { searchArtistStrict } from "@/lib/sources/showstart";
import { fetchArtistAvatar } from "@/lib/adapters/netease";
import { SubrequestBudget } from "@/lib/budget";

// Batch size per backfill pass. The SubrequestBudget is the hard ceiling on
// external fetches (a netease miss falls through to a Showstart search, so
// one artist can cost two takes); this cap just keeps a single pass from
// hogging the whole invocation. Artists past either limit stay pending and
// get picked up on a later load.
const AVATAR_LOOKUP_LIMIT = 30;
// One slow lookup shouldn't hang the whole pass.
const AVATAR_LOOKUP_TIMEOUT_MS = 4000;

// Unlike a `Promise.race` that resolves null on timeout, this REJECTS — so a
// timeout is indistinguishable from any other thrown error to the caller,
// and neither gets treated as "lookup succeeded, no match" (see below).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("avatar lookup timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Lazily backfill avatars. Pending rows are those never looked up
// (avatar === null) plus searched-empty ("") rows that gained a netease id —
// a Showstart miss says nothing about netease, which knows every playlist
// artist. avatar semantics: null = never searched, "" = every source we had
// came up empty (don't re-search), a URL = found. Mutates rows in place;
// never throws.
//
// An artist with a netease id resolves via head-info (exact, by id). A
// DEFINITIVE "profile has no photo" clears the id (so the row can't loop
// through the netease path on every load) and falls through to one Showstart
// name search. Artists without an id go straight to Showstart.
//
// Critical: only a DEFINITIVE "lookup succeeded, nothing found" may cache
// "". A timeout or a network/parse error must leave the row's state as-is so
// it is retried on the next load — caching those as "" would be
// indistinguishable from a genuine miss and the avatar would never be found.
// That's why this uses searchArtistStrict / fetchArtistAvatar (both throw on
// error) instead of a null-swallowing variant.
export async function backfillAvatars(
  db: D1Database,
  artists: ArtistRow[],
  budget: SubrequestBudget = new SubrequestBudget(),
): Promise<void> {
  const pending = artists
    .filter((a) => a.avatar === null || (a.avatar === "" && a.neteaseId))
    .slice(0, AVATAR_LOOKUP_LIMIT);
  await Promise.all(
    pending.map(async (artist) => {
      try {
        if (artist.neteaseId) {
          if (!budget.tryTake()) return;
          const fromNetease = await withTimeout(
            fetchArtistAvatar(artist.neteaseId),
            AVATAR_LOOKUP_TIMEOUT_MS,
          );
          if (fromNetease) {
            await setArtistAvatar(db, artist.id, fromNetease);
            artist.avatar = fromNetease;
            return;
          }
          await setArtistNeteaseId(db, artist.id, null);
          artist.neteaseId = null;
        }
        if (!budget.tryTake()) return;
        const hit = await withTimeout(searchArtistStrict(artist.name), AVATAR_LOOKUP_TIMEOUT_MS);
        const avatar = hit?.avatar ?? ""; // mark searched-empty when no hit or hit has no photo
        await setArtistAvatar(db, artist.id, avatar);
        artist.avatar = avatar;
      } catch {
        // timeout or error: leave the row as-is, retried on a later load
      }
    }),
  );
}
