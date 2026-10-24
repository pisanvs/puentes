import { defineAgent } from "eve";
import { REASON_MODEL } from "../../lib/models";

export default defineAgent({
  description:
    "Writes or rewrites a message from the owner to a friend (or an intro between two friends) in the owner's voice. Pass the friend, the context, the current draft and how to change it.",
  model: REASON_MODEL,
});
