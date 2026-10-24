export type Platform = "bluesky" | "x" | "linkedin" | "instagram";

export type RawPost = {
  nativeId: string;
  url: string;
  text: string;
  postedAt: number;
  raw?: unknown;
};

export type Snapshot = { headline?: string; company?: string; location?: string };

export type Collected = { posts: RawPost[]; snapshot?: Snapshot };
