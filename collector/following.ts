import { AtpAgent } from "@atproto/api";
import type { BrowserContext, Page } from "playwright";
import type { Contact } from "../agent/lib/contacts";
import { humanScroll, jitter } from "./browser";
import { captureJson, type Captured, walk } from "./net";
import { IG_APP_ID } from "./session";

const CAP = Number(process.env.IMPORT_CAP ?? 3000);
type Progress = (message: string) => void;

/**
 * Scroll until the page stops producing new contacts. `parse` reads contacts out of the
 * captured API responses; `more` can click a "show more" button when a page paginates that way.
 */
async function scrollUntilDone(
  page: Page,
  bodies: Captured[],
  parse: (bodies: Captured[]) => Map<string, Contact>,
  progress: Progress,
  label: string,
  more?: () => Promise<void>,
) {
  let found = parse(bodies);
  let idle = 0;
  while (idle < 4 && found.size < CAP) {
    await humanScroll(page, 3);
    await more?.();
    const next = parse(bodies);
    idle = next.size > found.size ? 0 : idle + 1;
    found = next;
    progress(`Found ${found.size} ${label}`);
  }
  return [...found.values()];
}

// ---- X: the Following timeline's GraphQL responses ----

function parseXUsers(bodies: Captured[], exclude: string) {
  const out = new Map<string, Contact>();
  for (const { body } of bodies)
    for (const o of walk(body)) {
      if (o.__typename !== "User" || typeof o.rest_id !== "string") continue;
      const handle: string | undefined = o.core?.screen_name ?? o.legacy?.screen_name;
      if (!handle || handle.toLowerCase() === exclude.toLowerCase()) continue;
      out.set(handle.toLowerCase(), {
        handle,
        name: o.core?.name ?? o.legacy?.name ?? handle,
        bio: o.legacy?.description ?? o.profile_bio?.description ?? null,
        followers: o.legacy?.followers_count ?? null,
        mutual: Boolean(o.relationship_perspectives?.followed_by ?? o.legacy?.followed_by),
      });
    }
  return out;
}

export async function importXFollowing(ctx: BrowserContext, me: string, progress: Progress) {
  const page = await ctx.newPage();
  const cap = captureJson(page, /\/graphql\/[^/]+\/Following\b/, "x-following");
  try {
    await page.goto(`https://x.com/${me}/following`, { waitUntil: "domcontentloaded" });
    await jitter(3000, 5000);
    return await scrollUntilDone(page, cap.bodies, (b) => parseXUsers(b, me), progress, "accounts you follow on X");
  } finally {
    await cap.settle();
    await page.close();
  }
}

// ---- LinkedIn: connections list via the voyager API ----

// Connections come from the voyager REST endpoint the My Network page calls. We page through it
// directly with same-origin fetch (cookies + csrf token), which is reliable and doesn't depend on
// scrolling the UI. Each element nests the connected member's profile.
const LI_CONNECTIONS = (start: number, count: number) =>
  `/voyager/api/relationships/dash/connections?decorationId=com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16&count=${count}&q=search&sortType=RECENTLY_ADDED&start=${start}`;

export async function importLinkedInConnections(ctx: BrowserContext, me: string | null, progress: Progress) {
  const page = await ctx.newPage();
  try {
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
    await jitter(1500, 3000);

    const out = new Map<string, Contact>();
    const PAGE = 40;
    for (let start = 0; start < CAP; start += PAGE) {
      const raw = await page.evaluate(
        async ([url]) => {
          const csrf = (document.cookie.match(/JSESSIONID="?([^";]+)"?/) || [])[1] || "";
          const r = await fetch(url, {
            headers: { "csrf-token": csrf, accept: "application/json", "x-restli-protocol-version": "2.0.0" },
            credentials: "include",
          });
          if (!r.ok) return { error: r.status };
          return await r.json();
        },
        [LI_CONNECTIONS(start, PAGE)],
      );

      if ((raw as { error?: number }).error) throw new Error(`LinkedIn connections API returned ${(raw as { error: number }).error}.`);
      const elements: Record<string, any>[] = (raw as any).elements ?? [];
      for (const el of elements) {
        const p = el.connectedMemberResolutionResult;
        const slug = p?.publicIdentifier;
        if (!slug || slug === me) continue;
        out.set(slug, {
          handle: slug,
          name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || slug,
          bio: p.headline ?? null,
          followers: null,
          mutual: true, // connections are mutual by definition
        });
      }
      progress(`Found ${out.size} LinkedIn connections`);
      if (elements.length < PAGE) break; // last page
      await jitter(1200, 2600); // don't hammer the API
    }
    return [...out.values()];
  } finally {
    await page.close();
  }
}

// ---- Instagram: the private web API (/api/v1/) ----

/**
 * Resolve a username to its numeric IG id via the web_profile_info API. Needs the app-id header.
 * Returned inside `data.user.id`.
 */
export async function instagramUserId(page: Page, username: string): Promise<string | null> {
  const body = await page.evaluate(
    async ([user, appId]) => {
      const r = await fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(user)}`, {
        headers: { "x-ig-app-id": appId },
        credentials: "include",
      });
      return r.ok ? await r.json() : { error: r.status };
    },
    [username, IG_APP_ID],
  );
  if ((body as any)?.error) throw new Error(`Instagram web_profile_info returned ${(body as any).error} for ${username}.`);
  return (body as any)?.data?.user?.id ?? null;
}

/**
 * Everyone the owner follows. IG pages the following list through
 * `/api/v1/friendships/<id>/following/?count=&max_id=`, which needs the app-id header and the
 * csrf token from the `csrftoken` cookie. We fetch in-page (same-origin, cookies attached) rather
 * than scrolling the modal, which is flaky. Followers count isn't in this payload, and the list
 * doesn't reveal who follows back, so mutual stays false (derived later if we ever fetch it).
 */
export async function importInstagramFollowing(ctx: BrowserContext, me: string, progress: Progress) {
  const page = await ctx.newPage();
  try {
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
    await jitter(2500, 4500);

    // The owner's own numeric id IS the ds_user_id cookie — no throttled web_profile_info lookup needed.
    const dsUserId = (await ctx.cookies()).find((c) => c.name === "ds_user_id" && c.domain.includes("instagram.com"))?.value;
    const userId = dsUserId ?? (await instagramUserId(page, me));
    if (!userId) throw new Error(`Couldn't resolve the Instagram id for ${me}.`);

    const out = new Map<string, Contact>();
    let maxId: string | undefined;
    const PAGE = 50;
    do {
      // Retry on 429 with backoff — IG rate-limits hard.
      let raw: any = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        raw = await page.evaluate(
          async ([id, count, max, appId]) => {
            const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || "";
            const qs = new URLSearchParams({ count: String(count) });
            if (max) qs.set("max_id", String(max));
            const r = await fetch(`/api/v1/friendships/${id}/following/?${qs.toString()}`, {
              headers: { "x-ig-app-id": String(appId), "x-csrftoken": csrf, accept: "application/json" },
              credentials: "include",
            });
            if (!r.ok) return { error: r.status };
            return await r.json();
          },
          [userId, PAGE, maxId ?? "", IG_APP_ID] as const,
        );
        if (raw?.error !== 429) break;
        progress(`Instagram rate-limited (429), backing off… (attempt ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, 20000 + attempt * 20000)); // 20s, 40s, 60s…
      }

      if (raw?.error === 429 && out.size > 0) {
        progress(`Still rate-limited; keeping the ${out.size} found so far.`);
        break;
      }
      if (raw?.error) throw new Error(`Instagram following API returned ${raw.error}. IG throttles automation hard — wait a few minutes and retry.`);
      const users: Record<string, any>[] = raw.users ?? [];
      for (const u of users) {
        const handle: unknown = u.username;
        if (typeof handle !== "string" || handle.toLowerCase() === me.toLowerCase()) continue;
        out.set(handle.toLowerCase(), {
          handle,
          name: (typeof u.full_name === "string" && u.full_name.trim()) || handle,
          bio: null, // not in the following payload; the profile adapter fills it later
          followers: null,
          mutual: Boolean(u.friendship_status?.followed_by), // usually absent here → false
        });
      }
      progress(`Found ${out.size} accounts you follow on Instagram`);
      maxId = (raw as any).next_max_id ? String((raw as any).next_max_id) : undefined;
      if (!maxId || !users.length) break;
      await jitter(1500, 3200); // IG anti-bot is aggressive; keep it slow
    } while (out.size < CAP);

    return [...out.values()];
  } finally {
    await page.close();
  }
}

// ---- Bluesky: public API, no browser ----

const bsky = new AtpAgent({ service: "https://public.api.bsky.app" });

export async function importBlueskyFollows(me: string, progress: Progress) {
  const follows: { did: string; handle: string; displayName?: string; description?: string }[] = [];
  let cursor: string | undefined;
  do {
    const { data } = await bsky.app.bsky.graph.getFollows({ actor: me, limit: 100, cursor });
    follows.push(...data.follows);
    cursor = data.cursor;
    progress(`Found ${follows.length} accounts you follow on Bluesky`);
  } while (cursor && follows.length < CAP);

  // Mutuals and audience size: getRelationships (30 per call) and getProfiles (25 per call).
  const followedBy = new Set<string>();
  const followers = new Map<string, number>();
  for (let i = 0; i < follows.length; i += 30) {
    const { data } = await bsky.app.bsky.graph.getRelationships({ actor: me, others: follows.slice(i, i + 30).map((f) => f.did) });
    for (const r of data.relationships) if ("followedBy" in r && r.followedBy) followedBy.add(r.did as string);
  }
  for (let i = 0; i < follows.length; i += 25) {
    const { data } = await bsky.app.bsky.actor.getProfiles({ actors: follows.slice(i, i + 25).map((f) => f.did) });
    for (const p of data.profiles) followers.set(p.did, p.followersCount ?? 0);
    progress(`Read ${Math.min(i + 25, follows.length)}/${follows.length} Bluesky profiles`);
  }

  return follows.map<Contact>((f) => ({
    handle: f.handle,
    name: f.displayName?.trim() || f.handle,
    bio: f.description ?? null,
    followers: followers.get(f.did) ?? null,
    mutual: followedBy.has(f.did),
  }));
}
