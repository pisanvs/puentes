import type { BrowserContext } from "playwright";
import { humanScroll, jitter } from "../browser";
import type { Collected, RawPost } from "../types";

type Tweet = {
  rest_id: string;
  legacy: { full_text: string; created_at: string; retweeted_status_result?: unknown; in_reply_to_status_id_str?: string };
  note_tweet?: { note_tweet_results?: { result?: { text?: string } } };
  core?: { user_results?: { result?: { legacy?: { screen_name?: string }; core?: { screen_name?: string } } } };
};

/** Walk any GraphQL payload and pull out tweet objects. Robust to X reshuffling the timeline envelope. */
function* findTweets(node: unknown): Generator<Tweet> {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, any>;
  if (typeof obj.rest_id === "string" && obj.legacy?.full_text && obj.legacy?.created_at) yield obj as Tweet;
  for (const value of Object.values(obj)) yield* findTweets(value);
}

/** Read a profile's recent tweets by intercepting the UserTweets GraphQL responses the page loads anyway. */
export async function collectX(ctx: BrowserContext, handle: string, since: number): Promise<Collected> {
  const page = await ctx.newPage();
  const found = new Map<string, RawPost>();
  let oldest = Date.now();

  page.on("response", async (res) => {
    // X renames the profile-timeline op periodically. It's loaded "UserTweets" and, more recently,
    // "UserOriginalsTimeline" (the Posts tab, originals only). Match any of the known names so a
    // rename doesn't silently return 0 posts. findTweets below is shape-based, so the envelope is fine.
    if (!/\/graphql\/[^/]+\/(UserTweets|UserTweetsAndReplies|UserOriginalsTimeline|UserMedia)\b/.test(res.url())) return;
    try {
      for (const t of findTweets(await res.json())) {
        const author = t.core?.user_results?.result?.core?.screen_name ?? t.core?.user_results?.result?.legacy?.screen_name;
        if (author && author.toLowerCase() !== handle.toLowerCase()) continue; // quoted / promoted
        if (t.legacy.in_reply_to_status_id_str) continue; // skip replies (conversation noise)
        // Retweets are a signal — what they amplify. Keep them, marked. full_text is "RT @user: …".
        const isRepost = Boolean(t.legacy.retweeted_status_result);
        const postedAt = Date.parse(t.legacy.created_at);
        oldest = Math.min(oldest, postedAt);
        const text = t.note_tweet?.note_tweet_results?.result?.text ?? t.legacy.full_text;
        found.set(t.rest_id, {
          nativeId: t.rest_id,
          url: `https://x.com/${handle}/status/${t.rest_id}`,
          text: isRepost && !text.startsWith("RT ") ? `♻️ reposted: ${text}` : text,
          postedAt,
          raw: t,
        });
      }
    } catch {
      // non-JSON or aborted response
    }
  });

  try {
    await page.goto(`https://x.com/${handle}`, { waitUntil: "domcontentloaded" });
    await jitter(2500, 4500);
    for (let i = 0; i < 6 && oldest > since; i++) await humanScroll(page);
  } finally {
    await page.close();
  }

  return { posts: [...found.values()].filter((p) => p.postedAt >= since) };
}
