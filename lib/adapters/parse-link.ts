import type { PlatformId } from "./types";

export class InvalidPlaylistLinkError extends Error {
  constructor(input: string) {
    super(`Unrecognized playlist link: ${input}`);
    this.name = "InvalidPlaylistLinkError";
  }
}

export interface ParsedLink {
  platform: PlatformId;
  externalId: string;
}

function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/);
  return m ? m[0] : null;
}

export async function resolveShortLink(url: string): Promise<string> {
  const resp = await fetch(url, { redirect: "follow", method: "GET" });
  return resp.url || url;
}

function tryParse(rawUrl: string): ParsedLink | null {
  let url: URL;
  try {
    url = new URL(rawUrl.replace("/#/", "/"));
  } catch {
    return null;
  }
  const host = url.hostname;
  const idParam = url.searchParams.get("id");

  if (host.includes("music.163.com")) {
    if (idParam) return { platform: "netease", externalId: idParam };
    return null;
  }
  if (host.includes("y.qq.com") || host.includes("qq.com")) {
    if (idParam) return { platform: "qq", externalId: idParam };
    const m = url.pathname.match(/playlist\/(\d+)/);
    if (m) return { platform: "qq", externalId: m[1] };
    return null;
  }
  return null;
}

export async function parsePlaylistLink(input: string): Promise<ParsedLink> {
  const url = firstUrl(input.trim());
  if (!url) throw new InvalidPlaylistLinkError(input);

  let target = url;
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* leave host empty; falls through to tryParse which will reject */
  }
  if (host === "163cn.tv" || host.endsWith(".163cn.tv")) {
    target = await resolveShortLink(url);
  }
  const parsed = tryParse(target);
  if (!parsed) throw new InvalidPlaylistLinkError(input);
  return parsed;
}
