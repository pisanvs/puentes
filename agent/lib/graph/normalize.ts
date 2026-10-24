// Canonical key for deduping entities. Lowercase, strip accents and punctuation, collapse spaces,
// and drop common company/school noise words so "Stripe, Inc." and "Stripe" collapse together.
const STRIP_WORDS = /\b(inc|llc|ltd|corp|co|sa|spa|the|company|university|universidad|college)\b/g;

export function entityKey(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(STRIP_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clean a display name: trim, collapse whitespace, cap length. */
export const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, 120);
