import type { Env } from "../env";
import { getMailProvider } from "../mail/provider";
import { getMeta, setMeta } from "../db/meta";

// Consecutive failed runs before a city is worth an email. The crawl runs daily,
// so this is "broken two days running". It used to be 3, chosen when the sweep
// covered 2 cities and one bad night was plausibly a blip; across the whole
// country a city failing twice in a row is a real fault, not noise.
export const ALERT_AFTER_FAILURES = 2;
// While a city stays broken, repeat the alert this often rather than every run —
// one mail can be missed, thirty get filtered.
const REPEAT_EVERY = 7;

const KEY = "city_failure_streaks";

type Streaks = Record<string, number>;

async function readStreaks(db: D1Database): Promise<Streaks> {
  const raw = await getMeta(db, KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Streaks;
  } catch {
    return {}; // corrupt value must not take the crawl down
  }
}

// Alert on a PER-CITY failure streak.
//
// The previous rule only counted a run in which every single city failed, and
// reset the counter the moment any city succeeded. With 32 cities that made it
// nearly unreachable: 31 could fail every run forever while one healthy city held
// the streak at zero. It also meant the alert said "全局失败" — the one shape of
// outage it could see — so the code that read it assumed a signature change.
//
// Tracking each city separately catches both shapes: a whole-country outage
// trips every city's streak at once, and a single broken city trips its own.
export async function maybeAlertAdmin(
  db: D1Database,
  env: Env,
  failedCities: string[],
  cities: string[],
): Promise<boolean> {
  const previous = await readStreaks(db);
  const failed = new Set(failedCities);

  // Rebuild from `cities` rather than mutating: a city dropped from the list
  // should not keep a stale streak alive forever.
  const streaks: Streaks = {};
  for (const city of cities) {
    streaks[city] = failed.has(city) ? (previous[city] ?? 0) + 1 : 0;
  }
  await setMeta(db, KEY, JSON.stringify(streaks));

  // Mail on the run that crosses the threshold, then weekly while still broken.
  const worth = cities.filter((c) => {
    const n = streaks[c];
    return n === ALERT_AFTER_FAILURES || (n > ALERT_AFTER_FAILURES && n % REPEAT_EVERY === 0);
  });
  if (worth.length === 0 || !env.ADMIN_EMAIL) return false;

  const worstRun = Math.max(...worth.map((c) => streaks[c]));
  const allDown = worth.length === cities.length;
  await getMailProvider(env).send({
    to: env.ADMIN_EMAIL,
    subject: allDown
      ? "[show-remind] 秀动爬取全局失败"
      : `[show-remind] ${worth.length} 个城市爬取失败`,
    html:
      `<p>连续 ${worstRun} 轮失败的城市：${worth.join(", ")}（共 ${cities.length} 个城市）。</p>` +
      (allDown
        ? "<p>所有城市同时失败，大概率是上游接口或签名变更，请检查 lib/sources/showstart。</p>"
        : "<p>部分城市失败，可能是该城市的 id 映射、上游数据，或 /internal/crawl 本身出错。查 Worker 日志里的 crawlCity。</p>"),
  });
  return true;
}
