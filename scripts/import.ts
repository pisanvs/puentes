// npm run import -- x|linkedin|bluesky|instagram
// Pulls everyone you follow / are connected to, merges them into people, then prioritizes.
import { getAccount, saveAccount, upsertContacts } from "../agent/lib/contacts";
import { runJob } from "../agent/lib/jobs";
import { prioritize } from "../agent/lib/pipeline/prioritize";
import { openBrowser } from "../collector/browser";
import { importBlueskyFollows, importInstagramFollowing, importLinkedInConnections, importXFollowing } from "../collector/following";
import { instagramViewer, linkedinViewer, requireLogin, xViewer } from "../collector/session";

const platform = process.argv[2] as "x" | "linkedin" | "bluesky" | "instagram";
if (!["x", "linkedin", "bluesky", "instagram"].includes(platform)) throw new Error("usage: import.ts x|linkedin|bluesky|instagram");

await runJob(
  `import-${platform}`,
  async (progress) => {
    const account = await getAccount(platform);
    let contacts;

    if (platform === "bluesky") {
      if (!account?.handle) throw new Error("Add your Bluesky handle in Sources first.");
      contacts = await importBlueskyFollows(account.handle, progress);
    } else {
      const ctx = await openBrowser();
      await requireLogin(ctx, platform);
      let me = account?.handle ?? null;
      if (!me) {
        me = platform === "x" ? await xViewer(ctx) : platform === "instagram" ? await instagramViewer(ctx) : await linkedinViewer(ctx);
        await saveAccount(platform, { handle: me });
      }
      if (platform === "x") {
        if (!me) throw new Error("Couldn't tell which X account is signed in.");
        contacts = await importXFollowing(ctx, me, progress);
      } else if (platform === "instagram") {
        if (!me) throw new Error("Couldn't tell which Instagram account is signed in.");
        contacts = await importInstagramFollowing(ctx, me, progress);
      } else {
        contacts = await importLinkedInConnections(ctx, me, progress);
      }
    }

    progress(`Saving ${contacts.length} contacts`);
    const saved = await upsertContacts(platform, contacts);
    await saveAccount(platform, { importedAt: Date.now(), importedCount: contacts.length });
    const ranked = await prioritize(progress);
    return { imported: contacts.length, ...saved, ...ranked };
  },
  { browser: platform !== "bluesky" },
);
