import { defineTool } from "eve/tools";
import { z } from "zod";
import { getOwner, onTrip, ownerCard } from "../lib/me";
import { listObjectives } from "../lib/queries";
import { listWatched } from "../lib/topics";

export default defineTool({
  description:
    "Who the owner is: name, role, home base, current trip, what they're building and care about, facts they've told you, their objectives and watched topics. Load this before prioritizing, drafting, or judging what matters to them.",
  inputSchema: z.object({}),
  async execute() {
    const [me, card, objectives, topics] = await Promise.all([getOwner(), ownerCard(), listObjectives(), listWatched()]);
    return {
      card: card || "Nothing known yet — ask the owner who they are and save it with remember_about_me.",
      profile: { name: me.name, headline: me.headline, homeBase: me.homeBase, about: me.about, trip: me.trip, onTripNow: onTrip(me), facts: me.facts },
      objectives: objectives.map((o) => o.text),
      watchedTopics: topics.map((t) => t.name),
    };
  },
});
