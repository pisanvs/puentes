import { defineSchedule } from "eve/schedules";
import kapsoChannel, { kapso } from "../channels/kapso";
import { ownerWaId } from "../lib/owner";

// WhatsApp only allows free-form messages within 24h of the owner's last message.
// Outside that window this send fails until a utility template is registered in Kapso.
export default defineSchedule({
  cron: "0 8 * * *",
  async run({ to, waitUntil, appAuth }) {
    const threadId = await kapso.openDM(ownerWaId());
    waitUntil(
      to(kapsoChannel, { adapterName: "kapso", threadId }).send(
        "It's morning: send me today's digest (top follow-ups and the best intro).",
        { auth: appAuth },
      ),
    );
  },
});
