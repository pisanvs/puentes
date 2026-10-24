// npm run connect -- x|linkedin|instagram
// Opens the login page in the shared browser (you drive it from the dashboard's browser view)
// and waits until the site's session cookie appears, then records which account it is.
import { saveAccount } from "../agent/lib/contacts";
import { runJob } from "../agent/lib/jobs";
import { openBrowser, sleep } from "../collector/browser";
import { type BrowserPlatform, instagramViewer, isLoggedIn, LOGIN_URL, linkedinViewer, suppressPasskeys, xViewer } from "../collector/session";

const platform = process.argv[2] as BrowserPlatform;
if (platform !== "x" && platform !== "linkedin" && platform !== "instagram") throw new Error("usage: connect.ts x|linkedin|instagram");

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

await runJob(
  `connect-${platform}`,
  async (progress) => {
    const ctx = await openBrowser();
    if (!(await isLoggedIn(ctx, platform))) {
      const page = await ctx.newPage();
      await suppressPasskeys(ctx, page);
      await page.goto(LOGIN_URL[platform]);
      progress("Sign in using the browser view");
      const deadline = Date.now() + LOGIN_TIMEOUT_MS;
      while (!(await isLoggedIn(ctx, platform))) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for sign-in.");
        await sleep(1500);
      }
      await page.close().catch(() => {});
    }
    progress("Signed in. Checking which account…");
    const handle = platform === "x" ? await xViewer(ctx) : platform === "instagram" ? await instagramViewer(ctx) : await linkedinViewer(ctx);
    await saveAccount(platform, { handle, connectedAt: Date.now() });
    return { handle };
  },
  { browser: true },
);
