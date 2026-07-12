import cron from "node-cron";
import { runPipeline } from "@/lib/pipeline";
import { maybeAlertAdmin } from "@/lib/notifier/admin-alert";

let consecutiveFailures = 0;

async function tick(): Promise<void> {
  // jitter 0-15 min so runs are not on the exact minute
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 15 * 60 * 1000)));
  try {
    const cities = await import("@/lib/db").then(({ prisma }) =>
      prisma.userCity.findMany({ distinct: ["cityCode"] }),
    );
    const result = await runPipeline();
    const fullFailure = cities.length > 0 && result.failedCities.length === cities.length;
    consecutiveFailures = fullFailure ? consecutiveFailures + 1 : 0;
    await maybeAlertAdmin(result.failedCities, cities.length, consecutiveFailures);
    console.log(`[worker] pipeline done`, result);
  } catch (err) {
    consecutiveFailures += 1;
    console.error(`[worker] pipeline crashed`, err);
  }
}

// 10:00 and 20:00 daily (server local time)
cron.schedule("0 10,20 * * *", () => void tick());
console.log("[worker] scheduled: 0 10,20 * * *");
