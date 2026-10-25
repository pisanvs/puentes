export type Platform = "bluesky" | "x" | "linkedin" | "instagram";

export type RawPost = {
  nativeId: string;
  url: string;
  text: string;
  postedAt: number;
  raw?: unknown;
};

export type Snapshot = { headline?: string; company?: string; location?: string };

/**
 * Who you both know, as the profile itself surfaces it — only the handful of names the UI shows plus
 * its count, never a crawl. X/Instagram give handles; LinkedIn shows first names only.
 */
export type Mutuals = {
  handles?: string[];
  names?: string[];
  /** The profile's own count ("and 74 other" → shown + 74). */
  total?: number;
  /** They follow / are connected back to the owner, when the profile says so. */
  followsYou?: boolean;
};

export type Collected = { posts: RawPost[]; snapshot?: Snapshot; mutuals?: Mutuals };
