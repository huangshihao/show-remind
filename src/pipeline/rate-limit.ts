// Deliberate pacing between Showstart detail fetches. Showstart sits behind a
// WAF that rejects unadorned/bursty clients (see docs/showstart-reverse-engineering.md),
// so the crawler stays slow and irregular on purpose rather than fetching flat out.
//
// Its own module so crawlCity calls it through an imported binding, which lets
// tests stub the wait the same way they stub showstart.fetchShowDetail. Inlining
// it in crawl.ts would make a full-cap crawl test sleep for real (~30s).
const jitterMs = () => 800 + Math.floor(Math.random() * 800);

export async function paceCrawl(): Promise<void> {
  await new Promise((r) => setTimeout(r, jitterMs()));
}
