import { generateText } from "ai";
import type { BrowserContext, Page } from "playwright";
import { jitter } from "../browser";
import { captureJson, walk } from "../net";
import { IG_APP_ID } from "../session";
import type { Collected, Mutuals, RawPost, Snapshot } from "../types";

// Everything here reads Instagram's private web API (/api/v1/) JSON, never the rendered DOM.
// Those endpoints need the x-ig-app-id header the web client sends on every request; we mirror it
// on in-page fetches (same-origin, so the session cookies ride along). Low volume + jitter: IG's
// anti-bot is aggressive.

type IgMediaItem = {
  pk?: string | number;
  code?: string;
  taken_at?: number; // unix seconds
  caption?: { text?: string } | null;
  product_type?: string; // "clips" = reel, "feed" = photo/video
};

const CAP_POSTS = Number(process.env.IG_POSTS_CAP ?? 24);

/** Run an authenticated in-page GET against IG's web API and return parsed JSON (or throw on non-2xx). */
async function igGet(page: Page, path: string): Promise<any> {
  const raw = await page.evaluate(
    async ([p, appId]) => {
      const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
      const r = await fetch(p, {
        headers: { "x-ig-app-id": String(appId), "x-csrftoken": csrf, accept: "application/json" },
        credentials: "include",
      });
      if (!r.ok) return { __error: r.status };
      return await r.json();
    },
    [path, IG_APP_ID] as const,
  );
  if (raw && typeof raw === "object" && "__error" in raw) throw new Error(`Instagram ${path} returned ${(raw as any).__error}.`);
  return raw;
}

const mediaUrl = (item: IgMediaItem) =>
  item.code ? `https://www.instagram.com/${item.product_type === "clips" ? "reel" : "p"}/${item.code}/` : `https://www.instagram.com/`;

function toPost(item: IgMediaItem): RawPost | null {
  const id = item.code ?? (item.pk != null ? String(item.pk) : undefined);
  if (!id) return null;
  return {
    nativeId: String(id),
    url: mediaUrl(item),
    text: item.caption?.text?.trim() ?? "",
    postedAt: (item.taken_at ?? 0) * 1000,
    raw: item,
  };
}

/** Read bio/headline from web_profile_info. IG exposes no reliable company/location, so those stay undefined. */
function parseSnapshot(profile: any): Snapshot {
  const user = profile?.data?.user ?? profile?.user ?? profile;
  const bio: unknown = user?.biography;
  const category: unknown = user?.category_name; // business/creator category, closest thing to a headline
  const headline = (typeof category === "string" && category) || (typeof bio === "string" && bio.trim()) || undefined;
  return { headline: headline || undefined };
}

/**
 * "Followed by a, b + 12 more" from the web_profile_info we already fetch: the few usernames the
 * profile shows plus its count, and whether they follow you. Nothing extra is requested.
 */
export function parseInstagramMutuals(profile: any): Mutuals | undefined {
  const user = profile?.data?.user ?? profile?.user ?? profile;
  const edge = user?.edge_mutual_followed_by;
  const handles: string[] = (edge?.edges ?? []).map((e: any) => e?.node?.username).filter((u: unknown): u is string => typeof u === "string");
  const total = typeof edge?.count === "number" ? edge.count : handles.length || undefined;
  const followsYou = typeof user?.follows_viewer === "boolean" ? user.follows_viewer : undefined;
  if (!handles.length && total === undefined && followsYou === undefined) return undefined;
  return { handles, total, followsYou };
}

/**
 * Profile snapshot + recent feed posts/reels for one tracked account.
 * `opts.posts` toggles the (slower) media pagination; `opts.watchStories` — or IG_WATCH_STORIES=1 —
 * additionally pulls the person's CURRENT stories. See collectInstagramStories for the privacy caveat.
 */
export async function collectInstagram(
  ctx: BrowserContext,
  username: string,
  since: number,
  opts: { posts?: boolean; watchStories?: boolean } = {},
): Promise<Collected> {
  const { posts: wantPosts = true, watchStories = false } = opts;
  const page = await ctx.newPage();
  try {
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: "domcontentloaded" });
    await jitter(2500, 4500);

    const profile = await igGet(page, `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`);
    const snapshot = parseSnapshot(profile);
    const mutuals = parseInstagramMutuals(profile);
    const userId: string | undefined = profile?.data?.user?.id;

    const posts: RawPost[] = [];
    if (wantPosts && userId) {
      let maxId: string | undefined;
      while (posts.length < CAP_POSTS) {
        const qs = maxId ? `?count=12&max_id=${encodeURIComponent(maxId)}` : `?count=12`;
        const feed = await igGet(page, `/api/v1/feed/user/${userId}/${qs}`);
        const items: IgMediaItem[] = feed?.items ?? [];
        for (const it of items) {
          const p = toPost(it);
          if (p && p.postedAt >= since && p.text) posts.push(p);
        }
        const oldest = Math.min(...items.map((i) => (i.taken_at ?? 0) * 1000), Date.now());
        maxId = feed?.more_available && feed?.next_max_id ? String(feed.next_max_id) : undefined;
        if (!maxId || oldest < since || !items.length) break;
        await jitter(1800, 3500);
      }
    }

    if (watchStories || process.env.IG_WATCH_STORIES === "1") {
      if (userId) posts.push(...(await collectInstagramStories(ctx, username, userId, { confirm: true })));
    }

    return { posts, snapshot, mutuals };
  } finally {
    await page.close();
  }
}

/**
 * ⚠️ PRIVACY CAVEAT — stories are watched, and watching is VISIBLE to the person.
 * Loading someone's stories through the API (reels_media / user story feed) registers the owner's
 * account in that person's "viewers" list, exactly as if they had tapped the story in the app.
 * There is no silent read. This is therefore gated behind an explicit opt-in: either
 * `opts.confirm === true` or the env var IG_WATCH_STORIES=1. Called with neither, it no-ops and
 * returns []. Never enable it implicitly.
 */
export async function collectInstagramStories(
  ctx: BrowserContext,
  username: string,
  userId: string,
  opts: { confirm?: boolean } = {},
): Promise<RawPost[]> {
  if (!(opts.confirm || process.env.IG_WATCH_STORIES === "1")) return []; // opt-in only: watching is visible to them
  const page = await ctx.newPage();
  try {
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: "domcontentloaded" });
    await jitter(2000, 4000);
    const data = await igGet(page, `/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(userId)}`);
    const reel = data?.reels?.[userId] ?? data?.reels_media?.[0];
    const items: IgMediaItem[] = reel?.items ?? [];
    return items
      .map((it): RawPost | null => {
        const id = it.pk != null ? String(it.pk) : it.code;
        if (!id) return null;
        // Story location sticker = a temporary / current location (where they are right now) —
        // a strong serendipity signal. Fold it into the text so extraction picks it up as a place.
        const anyIt = it as Record<string, any>;
        const loc: string | undefined =
          anyIt.story_locations?.[0]?.location?.name ??
          anyIt.story_locations?.[0]?.location?.short_name ??
          anyIt.location?.name ??
          anyIt.location?.city;
        const caption = it.caption?.text?.trim() ?? "";
        const text = [loc ? `📍 currently at ${loc} (story)` : "", caption].filter(Boolean).join(" — ");
        return {
          nativeId: `story:${id}`,
          url: `https://www.instagram.com/stories/${username}/${id}/`,
          text,
          postedAt: (it.taken_at ?? 0) * 1000,
          raw: it,
        };
      })
      .filter((p): p is RawPost => p !== null);
  } finally {
    await page.close();
  }
}

/**
 * Posts this person is TAGGED in (a proxy for reposts/mentions) via the usertags feed. Reading
 * tagged media is passive — unlike stories it does NOT notify the person.
 */
export async function collectInstagramTagged(ctx: BrowserContext, username: string, userId: string, since: number): Promise<RawPost[]> {
  const page = await ctx.newPage();
  try {
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: "domcontentloaded" });
    await jitter(2000, 4000);
    const feed = await igGet(page, `/api/v1/usertags/${userId}/feed/?count=12`);
    const items: IgMediaItem[] = feed?.items ?? [];
    return items
      .map((it): RawPost | null => {
        const p = toPost(it);
        return p ? { ...p, nativeId: `tagged:${p.nativeId}` } : null;
      })
      .filter((p): p is RawPost => p !== null && p.postedAt >= since);
  } finally {
    await page.close();
  }
}

export type CommentHit = { url: string; snippet: string };

/**
 * Best-effort discovery of public mentions/comments about a username across the web via a
 * `site:instagram.com +<username>` style search.
 *
 * Preference order:
 *  1. Perplexity `perplexity/sonar` through the Vercel AI Gateway (grounded, reliable) — used when
 *     AI_GATEWAY_API_KEY is set.
 *  2. DuckDuckGo's HTML endpoint (https://html.duckduckgo.com/html/) via the shared browser.
 *
 * ⚠️ CAVEAT: a plain Google `site:` query is deliberately NOT used — Google CAPTCHAs automated
 * queries almost immediately, so it's unreliable. DuckDuckGo's HTML endpoint is far less
 * aggressive but still best-effort/fragile and can change or rate-limit. Keep volume tiny.
 */
export async function searchInstagramComments(username: string, ctx?: BrowserContext): Promise<CommentHit[]> {
  const query = `site:instagram.com +${username}`;

  if (process.env.AI_GATEWAY_API_KEY) {
    try {
      const { text, sources } = await generateText({
        model: "perplexity/sonar",
        prompt: `Find recent public Instagram posts or comments that mention "${username}". Return the URLs and a one-line snippet for each. Query: ${query}`,
      });
      const hits: CommentHit[] = [];
      for (const s of (sources ?? []) as any[]) {
        if (s?.url) hits.push({ url: s.url, snippet: s.title ?? "" });
      }
      if (hits.length) return hits.slice(0, 10);
      // No structured sources: fall back to scraping URLs out of the answer text.
      for (const m of text.matchAll(/https?:\/\/\S+/g)) hits.push({ url: m[0], snippet: "" });
      return hits.slice(0, 10);
    } catch {
      // gateway not wired / model unavailable → fall through to DuckDuckGo
    }
  }

  if (!ctx) return []; // no gateway and no browser to fall back to
  const page = await ctx.newPage();
  try {
    await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded" });
    await jitter(1500, 3000);
    // DuckDuckGo HTML results: `a.result__a` carries the link; its href may be a /l/?uddg= redirect.
    const hits: CommentHit[] = await page.evaluate(() => {
      const decode = (href: string) => {
        const m = href.match(/[?&]uddg=([^&]+)/);
        return m ? decodeURIComponent(m[1]) : href;
      };
      return Array.from(document.querySelectorAll("a.result__a"))
        .slice(0, 10)
        .map((a) => ({ url: decode((a as HTMLAnchorElement).getAttribute("href") || ""), snippet: (a.textContent || "").trim() }))
        .filter((h) => h.url);
    });
    return hits;
  } finally {
    await page.close();
  }
}
