import { AtpAgent } from "@atproto/api";
import type { Collected } from "../types";

// Public AppView: author feeds need no login.
const agent = new AtpAgent({ service: "https://public.api.bsky.app" });

export async function collectBluesky(handle: string, since: number): Promise<Collected> {
  const { data } = await agent.app.bsky.feed.getAuthorFeed({
    actor: handle,
    limit: 50,
    filter: "posts_no_replies",
  });

  const posts = data.feed
    .map((item) => {
      const post = item.post;
      const record = post.record as { text?: string; createdAt?: string };
      const rkey = post.uri.split("/").pop()!;
      // A repost is a signal too — what they chose to amplify. Mark it so triage/extraction knows.
      const isRepost = Boolean(item.reason);
      const author = (post.author as { handle?: string })?.handle;
      return {
        nativeId: isRepost ? `repost:${post.uri}` : post.uri,
        url: `https://bsky.app/profile/${author ?? handle}/post/${rkey}`,
        text: isRepost ? `♻️ reposted${author ? ` @${author}` : ""}: ${record.text ?? ""}` : (record.text ?? ""),
        postedAt: isRepost ? Date.parse(post.indexedAt) : Date.parse(record.createdAt ?? post.indexedAt),
        raw: post,
      };
    })
    .filter((p) => p.text && p.postedAt >= since);

  return { posts };
}

/** Accounts the owner follows, for seeding people.yaml. */
export async function blueskyFollows(actor: string) {
  const out: { handle: string; displayName?: string }[] = [];
  let cursor: string | undefined;
  do {
    const { data } = await agent.app.bsky.graph.getFollows({ actor, limit: 100, cursor });
    out.push(...data.follows.map((f) => ({ handle: f.handle, displayName: f.displayName })));
    cursor = data.cursor;
  } while (cursor && out.length < 1000);
  return out;
}
