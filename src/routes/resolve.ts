import { Hono } from "hono";
import type { Env } from "../env";
import { resolvePlaylist } from "../services/resolve";
import { verifyTurnstile } from "../turnstile";
import { InvalidPlaylistLinkError } from "@/lib/adapters/parse-link";
import { SubrequestBudget } from "@/lib/budget";

export const resolveRouter = new Hono<{ Bindings: Env }>();

resolveRouter.post("/", async (c) => {
  const { link, turnstileToken } = await c.req.json<{ link?: string; turnstileToken?: string }>();
  if (!link || typeof link !== "string") return c.json({ error: "缺少歌单链接" }, 400);

  if (c.env.PUBLIC_MODE === "1") {
    let ok = false;
    try {
      ok = !!turnstileToken && (await verifyTurnstile(turnstileToken, c.env.TURNSTILE_SECRET));
    } catch {
      ok = false;
    }
    if (!ok) return c.json({ error: "人机校验失败，请重试" }, 400);
  }

  try {
    // One budget per invocation: playlist pagination + avatar lookups share it.
    const result = await resolvePlaylist(link, new SubrequestBudget());
    if (result.artists.length === 0) {
      return c.json({ error: "没有从歌单里解析到艺人，换个歌单试试" }, 422);
    }
    // sourceId is a persistence detail for the import path, not public API.
    return c.json({
      platform: result.platform,
      title: result.title,
      artists: result.artists.map(({ sourceId: _sourceId, ...rest }) => rest),
    });
  } catch (err) {
    if (err instanceof InvalidPlaylistLinkError) {
      return c.json({ error: "无法识别的链接，请粘贴网易云或 QQ 音乐的公开歌单链接" }, 400);
    }
    // upstream empty/transient (e.g. netease block, CF edge 1042) — client may retry
    return c.json({ error: "歌单解析失败，可能未公开或上游繁忙，请稍后重试" }, 502);
  }
});
