import type { BrowserContext, Page } from "playwright";
import { humanScroll, jitter } from "../browser";
import { captureJson, type Captured, walk } from "../net";
import type { Collected, Mutuals, RawPost, Snapshot } from "../types";

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
      // The profile card: match on the slug, pull headline + the "based in" location field.
      if (o.publicIdentifier === slug) {
        if (typeof o.headline === "string") headline ??= o.headline;
        else if (typeof o.occupation === "string") headline ??= o.occupation; // dash profile card uses occupation
        const geo = o.geoLocation?.geo ?? byUrn.get(o.geoLocation?.["*geo"] ?? o.geoLocation?.geoUrn ?? "");
        location ??=
          o.geoLocationName ?? // "San Francisco Bay Area"
          geo?.defaultLocalizedNameWithoutCountryName ??
          geo?.defaultLocalizedName ??
          o.locationName ??
          o.geoCountryName ??
          undefined;
      }
      // Current position: has a company and a start date but no end date.
      if (!company && typeof o.companyName === "string" && o.dateRange?.start && !o.dateRange?.end) company = o.companyName;
    }

  company ??= headline?.match(/\bat\s+(.+)$/i)?.[1]?.trim();
  return { headline, location, company };
}

function parsePosts(bodies: Captured[], slug: string): RawPost[] {
  const posts = new Map<string, RawPost & { own: boolean }>();
  const me = slug.toLowerCase();
  for (const { body } of bodies)
    for (const o of walk(body)) {
      // A real feed update (not a comment, reaction or type stub) carries an fsd_update entityUrn and
      // the clean activity urn in metadata.backendUrn, with the text at commentary.text.text.
      if (typeof o.entityUrn !== "string" || !o.entityUrn.includes("fsd_update:")) continue;
      const urn: unknown = o.metadata?.backendUrn;
      const text: unknown = o.commentary?.text?.text;
      if (typeof urn !== "string" || !urn.startsWith("urn:li:activity:") || typeof text !== "string" || !text.trim()) continue;
      const id = urn.split(":").pop()!;
      // The displayed actor is the content's author. On a recent-activity page that's the person for
      // their own posts, and the ORIGINAL author for things they reshared — we keep both (what someone
      // amplifies is signal too), marking reshares. The old actor===slug check dropped every reshare.
      const target: string = o.actor?.navigationContext?.actionTarget ?? "";
      const authorHandle = /\/in\/([^?/]+)/.exec(target)?.[1]?.toLowerCase();
      const authorName: string | undefined = o.actor?.name?.text;
      const own = !!authorHandle && authorHandle === me;
      const prev = posts.get(id);
      if (prev && (prev.own || !own)) continue; // keep the person's own copy over a reshared duplicate
      posts.set(id, {
        own,
        nativeId: own ? id : `repost:${id}`,
        url: `https://www.linkedin.com/feed/update/${urn}/`,
        text: own ? text.trim() : `♻️ reposted${authorName ? ` ${authorName}` : ""}: ${text.trim()}`,
        postedAt: activityTime(id),
      });
    }
  return [...posts.values()].map(({ own, ...p }) => p);
}

async function load(page: Page, url: string) {
  const res = await page.goto(url, { waitUntil: "domcontentloaded" });
  await jitter(2500, 4500);
  return res;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

/**
 * The "Víctor, Javier and 74 other mutual connections" line on a profile. LinkedIn now server-renders
 * the profile top card into the page HTML (no voyager call fires for it), so we read it from the
 * document response — anchored on the line's `connectionOf=` search link, not on hashed CSS classes.
 * Only what the card shows: the named people (first names) plus its count. We never open the list.
 */
export function parseLinkedInMutuals(html: string): Mutuals | undefined {
  for (const m of html.matchAll(/<a\b[^>]*connectionOf=[^>]*>([\s\S]{0,1200}?)<\/a>/gi)) {
    const inner = m[1];
    if (!/mutual connection/i.test(inner)) continue;
    const names = [...inner.matchAll(/<strong[^>]*>([^<]+)<\/strong>/gi)].map((n) => decode(n[1])).filter(Boolean);
    const others = Number(/([\d,]+)\s+other mutual connection/i.exec(inner)?.[1]?.replace(/,/g, "") ?? 0);
    return { names, total: names.length + others };
  }
  return undefined;
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
    const profileRes = await load(page, `https://www.linkedin.com/in/${slug}/`);
    const mutuals = parseLinkedInMutuals((await profileRes?.text().catch(() => "")) ?? "");
    await humanScroll(page, 2); // the profile card + location load lazily; a scroll coaxes the query
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
    return { posts, snapshot, mutuals };
  } finally {
    await page.close();
  }
}
