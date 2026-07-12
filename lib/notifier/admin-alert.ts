import { sendMail } from "./mailer";

export async function maybeAlertAdmin(
  failedCities: string[],
  cityCount: number,
  consecutiveFailures: number,
): Promise<boolean> {
  const fullFailure = cityCount > 0 && failedCities.length === cityCount;
  if (!fullFailure || consecutiveFailures < 3) return false;
  const admin = process.env.ADMIN_ALERT_EMAIL;
  if (!admin) return false;
  await sendMail(
    admin,
    "[show-remind] 秀动爬取连续失败",
    `<p>已连续 ${consecutiveFailures} 轮全局爬取失败,失败城市:${failedCities.join(", ")}。大概率是签名算法变更,请检查 lib/sources/showstart。</p>`,
  );
  return true;
}
