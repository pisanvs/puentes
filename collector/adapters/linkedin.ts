import type { BrowserContext, Page } from "playwright";
import { humanScroll, jitter } from "../browser";
import { captureJson, type Captured, walk } from "../net";
import type { Collected, RawPost, Snapshot } from "../types";

// Everything here is read from LinkedIn's voyager API responses (normalized JSON with an
// `included` array of typed entities). Parsers match entity shapes, not query ids, which churn.
const VOYAGER = /\/voyager\/api\//;

/** LinkedIn activity ids embed their creation time in the top 41 bits. */
const activityTime = (id: string) => Number(BigInt(id) >> 22n);

function entityIndex(bodies: Captured[]) {
  const byUrn = new Map<string, Record<string, any>>();
  for (const { body } of bodies) for (const o of walk(body)) if (typeof o.entityUrn === "string") byUrn.set(o.entityUrn, o);
  return byUrn;
}

function parseProfile(bodies: Captured[], slug: string): Snapshot {
  const byUrn = entityIndex(bodies);
  let headline: string | undefined;
  let location: string | undefined;
  let company: string | undefined;

  for (const { body } of bodies)
    for (const o of walk(body)) {
      if (o.publicIdentifier === slug && typeof o.headline === "string") {
        headline ??= o.headline;
        const geo = o.geoLocation?.geo ?? byUrn.get(o.geoLocation?.["*geo"] ?? o.geoLocation?.geoUrn ?? "");
        location ??= geo?.defaultLocalizedNameWithoutCountryName ?? geo?.defaultLocalizedName ?? o.locationName ?? undefined;
      }
      // Current position: has a company and a start date but no end date.
      if (!company && typeof o.companyName === "string" && o.dateRange?.start && !o.dateRange?.end) company = o.companyName;
    }

  company ??= headline?.match(/\bat\s+(.+)$/i)?.[1]?.trim();
  return { headline, location, company };
}

function parsePosts(bodies: Captured[], slug: string): RawPost[] {
  const posts = new Map<string, RawPost>();
  for (const { body } of bodies)
    for (const o of walk(body)) {
      const urn: unknown = o.metadata?.backendUrn ?? o.updateMetadata?.urn;
      const text: unknown = o.commentary?.text?.text;
      if (typeof urn !== "string" || !urn.startsWith("urn:li:activity:") || typeof text !== "string" || !text.trim()) continue;
      // Headered updates are "X reposted / liked / commented on this". Keep reposts (amplification
      // is a signal), skip likes/comments (noise). Their own posts have no header.
      const headerText: string = o.header?.text?.text ?? o.header?.text ?? "";
      const isRepost = /\brepost|\bshared\b/i.test(headerText);
      if (o.header && !isRepost) continue;
      if (!o.header && o.actor && !JSON.stringify(o.actor).includes(slug)) continue;
      const id = urn.split(":").pop()!;
      posts.set(id, {
        nativeId: isRepost ? `repost:${id}` : id,
        url: `https://www.linkedin.com/feed/update/${urn}/`,
        text: isRepost ? `♻️ reposted: ${text.trim()}` : text.trim(),
        postedAt: activityTime(id),
      });
    }
  return [...posts.values()];
}

async function load(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await jitter(2500, 4500);
}

export async function collectLinkedIn(
  ctx: BrowserContext,
  slug: string,
  since: number,
  opts: { posts: boolean } = { posts: true },
): Promise<Collected> {
  const page = await ctx.newPage();
  const cap = captureJson(page, VOYAGER, `li-${slug}`);
  try {
    await load(page, `https://www.linkedin.com/in/${slug}/`);
    await cap.settle();
    const snapshot = parseProfile(cap.bodies, slug);

    let posts: RawPost[] = [];
    if (opts.posts) {
      cap.bodies.length = 0;
      await load(page, `https://www.linkedin.com/in/${slug}/recent-activity/all/`);
      await humanScroll(page, 5);
      await cap.settle();
      posts = parsePosts(cap.bodies, slug).filter((p) => p.postedAt >= since);
    }
    return { posts, snapshot };
  } finally {
    await page.close();
  }
}
