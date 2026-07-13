import type { Env } from "../env";
import { getMailProvider } from "../mail/provider";
import { bumpConsecutiveFailures, resetConsecutiveFailures } from "../db/meta";

export async function maybeAlertAdmin(
  db: D1Database,
  env: Env,
  failedCities: string[],
  cityCount: number,
): Promise<boolean> {
  const fullFailure = cityCount > 0 && failedCities.length === cityCount;
  if (!fullFailure) {
    await resetConsecutiveFailures(db);
    return false;
  }
  const streak = await bumpConsecutiveFailures(db);
  if (streak < 3 || !env.ADMIN_EMAIL) return false;
  await getMailProvider(env).send({
    to: env.ADMIN_EMAIL,
    subject: "[show-remind] 秀动爬取连续失败",
    html: `<p>已连续 ${streak} 轮全局爬取失败，失败城市：${failedCities.join(", ")}。大概率是签名算法变更，请检查 lib/sources/showstart。</p>`,
  });
  return true;
}
