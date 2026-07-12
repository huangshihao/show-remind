import { prisma } from "@/lib/db";
import type { ShowDetail } from "@/lib/scraper-client";

export async function filterNewShowstartIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const existing = await prisma.show.findMany({
    where: { showstartId: { in: ids } },
    select: { showstartId: true },
  });
  const have = new Set(existing.map((s) => s.showstartId));
  return ids.filter((id) => !have.has(id));
}

export async function upsertShow(d: ShowDetail): Promise<{ id: string; showstartId: string }> {
  const show = await prisma.show.upsert({
    where: { showstartId: d.showstartId },
    create: {
      showstartId: d.showstartId,
      title: d.title,
      cityCode: d.cityCode,
      venue: d.venue,
      showTime: d.showTime ? new Date(d.showTime) : null,
      price: d.price,
      url: d.url,
      performers: d.performers,
    },
    update: {},
    select: { id: true, showstartId: true },
  });
  return show;
}
