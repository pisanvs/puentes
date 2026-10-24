import { defineSchedule } from "eve/schedules";
import kapsoChannel, { kapso } from "../channels/kapso";
import { collectPushes } from "../lib/notify";
import { ownerWaId } from "../lib/owner";

// Proactive push: every half hour (waking hours) check for NEW follow-ups the scan produced and for
// inner-circle people who are cooling off, and message the owner about them WITHOUT being asked.
// collectPushes() marks what it returns as pushed, so nothing is ever sent twice.
//
// Delivery mirrors morning-digest: `send(prompt)` starts an agent turn and its reply goes to the owner's
// WhatsApp. Same 24h-window caveat — reliable cold-start needs a Kapso utility template; until then the
// dashboard's desktop alerts are the always-on fallback.
export default defineSchedule({
  cron: "*/30 9-22 * * *",
  async run({ to, waitUntil, appAuth }) {
    const { nudges, cooling } = await collectPushes();
    if (!nudges.length && !cooling.length) return;

    const lines = [
      ...nudges.map((n) => `- ${n.person}: ${n.reason}${n.draft ? ` | draft: "${n.draft}"` : ""}${n.sendLink ? ` | send: ${n.sendLink}` : ""}`),
      ...cooling.map((c) => `- ${c.person} is going cold${c.daysSince != null ? ` (last talked ${c.daysSince}d ago)` : ""} — worth reconnecting.`),
    ].join("\n");

    const prompt =
      "Proactively message the owner now — don't wait for them to ask. New things worth their attention just came in. " +
      "Relay these in your short, warm WhatsApp digest style (bold the names, one line on why now, the draft in quotes if present, then the send link). " +
      "These facts were gathered for you; don't invent anything beyond what's listed, and you don't need to call tools to re-confirm them.\n\n" +
      lines;

    const threadId = await kapso.openDM(ownerWaId());
    waitUntil(to(kapsoChannel, { adapterName: "kapso", threadId }).send(prompt, { auth: appAuth }));
  },
});
