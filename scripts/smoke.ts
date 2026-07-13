// Live smoke: hits the three real upstreams from GitHub Actions' egress and
// exits non-zero if any core path fails. Fixtures cover parsing; this covers
// live availability. Mirrors docs/scraper-smoke.md.
import { resolveNeteasePlaylist } from "../lib/adapters/netease";
import { fetchQqPlaylist } from "../lib/sources/qq";
import { fetchCityShows, fetchShowDetail } from "../lib/sources/showstart";

const NETEASE = "3778678"; // 热歌榜
const QQ = process.env.SMOKE_QQ_PLAYLIST ?? "7256912512";
const CITY = "310000"; // Shanghai

async function check(name: string, fn: () => Promise<string>): Promise<boolean> {
  try {
    console.log(`✓ ${name}: ${await fn()}`);
    return true;
  } catch (e) {
    console.error(`✗ ${name}: ${e}`);
    return false;
  }
}

async function main() {
  const results = await Promise.all([
    check("netease", async () => {
      const p = await resolveNeteasePlaylist(NETEASE);
      if (p.songs.length === 0) throw new Error("no songs");
      return `${p.title} (${p.songs.length} songs)`;
    }),
    check("qq", async () => {
      const p = await fetchQqPlaylist(QQ);
      if (p.songs.length === 0) throw new Error("no songs");
      return `${p.title} (${p.songs.length} songs)`;
    }),
    check("showstart", async () => {
      const { shows } = await fetchCityShows(CITY, 1);
      if (shows.length === 0) throw new Error("no shows");
      const d = await fetchShowDetail(shows[0].showstartId);
      return `${shows.length} shows, detail performers=${d.performers.length}`;
    }),
  ]);

  if (results.some((ok) => !ok)) process.exit(1);
}

main();
