import type { BrowserContext, Page } from "playwright";
import { jitter } from "./browser";
import { captureJson, walk } from "./net";

export type BrowserPlatform = "x" | "linkedin" | "instagram";

// Instagram's private web API lives under /api/v1/. Every call needs this app id header; the
// web client sends it on every request, so we mirror it when we fetch in-page.
export const IG_APP_ID = "936619743392459";

// Rejects WebAuthn immediately so a login page falls back to password instead of waiting on a
// passkey prompt (a native dialog an automated browser can't answer).
export const PASSKEY_OFF = `
try {
  const reject = () => Promise.reject(new DOMException("passkeys are off in this browser", "NotAllowedError"));
  if (navigator.credentials) { navigator.credentials.get = reject; navigator.credentials.create = reject; }
  if (window.PublicKeyCredential) {
    PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
    PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
  }
} catch (e) {}`;

/** Register the passkey-off script on a page BEFORE it navigates, via CDP so ordering is guaranteed. */
export async function suppressPasskeys(ctx: BrowserContext, page: Page) {
  try {
    const session = await ctx.newCDPSession(page);
    await session.send("Page.enable");
    await session.send("Page.addScriptToEvaluateOnNewDocument", { source: PASSKEY_OFF });
  } catch {}
}

// A session exists when the site's auth cookie is in the collector's Chrome profile.
const AUTH_COOKIE: Record<BrowserPlatform, { domain: string; name: string }> = {
  x: { domain: "x.com", name: "auth_token" },
  linkedin: { domain: "linkedin.com", name: "li_at" },
  instagram: { domain: "instagram.com", name: "sessionid" },
};

export const LOGIN_URL: Record<BrowserPlatform, string> = {
  x: "https://x.com/i/flow/login",
  linkedin: "https://www.linkedin.com/login",
  instagram: "https://www.instagram.com/accounts/login/",
};

const PLATFORM_LABEL: Record<BrowserPlatform, string> = { x: "X", linkedin: "LinkedIn", instagram: "Instagram" };

export async function isLoggedIn(ctx: BrowserContext, platform: BrowserPlatform) {
  const { domain, name } = AUTH_COOKIE[platform];
  return (await ctx.cookies()).some((c) => c.name === name && c.value && c.domain.replace(/^\./, "").endsWith(domain));
}

export async function requireLogin(ctx: BrowserContext, platform: BrowserPlatform) {
  if (!(await isLoggedIn(ctx, platform)))
    throw new Error(`Not signed in to ${PLATFORM_LABEL[platform]}. Sign in from Sources first.`);
}

/** The signed-in X account's screen name, read from the settings/viewer API calls x.com makes on load. */
export async function xViewer(ctx: BrowserContext): Promise<string | null> {
  const page = await ctx.newPage();
  const cap = captureJson(page, /account\/settings\.json|\/graphql\/[^/]+\/Viewer/, "x-viewer");
  try {
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
    await jitter(3000, 5000);
    await cap.settle();
    for (const { url, body } of cap.bodies) {
      if (url.includes("settings.json") && typeof (body as any)?.screen_name === "string") return (body as any).screen_name;
      for (const o of walk(body)) {
        const name = o.core?.screen_name ?? o.legacy?.screen_name;
        if (o.__typename === "User" && typeof name === "string") return name;
      }
    }
    // Last resort: the profile link in the nav.
    const href = await page.locator('a[data-testid="AppTabBar_Profile_Link"]').getAttribute("href", { timeout: 3000 }).catch(() => null);
    return href?.replace(/^\//, "") || null;
  } finally {
    await page.close();
  }
}

/** The signed-in LinkedIn member's public slug, from the /me API the feed calls. */
export async function linkedinViewer(ctx: BrowserContext): Promise<string | null> {
  const page = await ctx.newPage();
  const cap = captureJson(page, /\/voyager\/api\/(me\b|.*[?&]q=me)/, "li-viewer");
  try {
    await page.goto("https://www.linkedin.com/feed/", { waitUntil: "domcontentloaded" });
    await jitter(3000, 5000);
    await cap.settle();
    for (const { body } of cap.bodies)
      for (const o of walk(body)) if (typeof o.publicIdentifier === "string") return o.publicIdentifier;
    return null;
  } finally {
    await page.close();
  }
}

/**
 * The signed-in Instagram account's username. IG's private API (`/api/v1/users/<id>/info/`) is
 * aggressively rate-limited (429) from automation, so we read the username out of the home page's
 * embedded JSON instead, matching it to the `ds_user_id` cookie. No throttled API call.
 */
export async function instagramViewer(ctx: BrowserContext): Promise<string | null> {
  const page = await ctx.newPage();
  await suppressPasskeys(ctx, page);
  try {
    const dsUserId = (await ctx.cookies()).find((c) => c.name === "ds_user_id" && c.domain.includes("instagram.com"))?.value;
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
    await jitter(2000, 3500);
    const html = await page.content();
    if (dsUserId) {
      // The viewer's own id and username sit next to each other in the embedded data.
      const near =
        html.match(new RegExp(`"id":"${dsUserId}"[^}]*?"username":"([^"]+)"`)) ??
        html.match(new RegExp(`"username":"([^"]+)"[^}]*?"id":"${dsUserId}"`)) ??
        html.match(new RegExp(`"pk":"?${dsUserId}"?[^}]*?"username":"([^"]+)"`));
      if (near?.[1]) return near[1];
    }
    // Fallbacks that don't hit the throttled API.
    const viewer = html.match(/"viewer":\{[^}]*?"username":"([^"]+)"/) ?? html.match(/"CURRENT_USER_ID"[\s\S]{0,200}?"username":"([^"]+)"/);
    return viewer?.[1] ?? null;
  } finally {
    await page.close();
  }
}
