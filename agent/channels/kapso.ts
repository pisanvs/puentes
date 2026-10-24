import { createKapsoAdapter } from "@kapso/chat-adapter";
import { createMemoryState } from "@chat-adapter/state-memory";
import type { Message, Thread } from "chat";
import { chatSdkChannel, messageToUserContent } from "eve/channels/chat-sdk";
import { isOwner } from "../lib/owner";

// The adapter throws without a key, which would take MCP down with it.
// Boot with a placeholder so the rest of the agent works before Kapso is set up.
if (!process.env.KAPSO_API_KEY) console.warn("[kapso] KAPSO_API_KEY not set: WhatsApp is disabled.");

export const kapso = createKapsoAdapter({
  kapsoApiKey: process.env.KAPSO_API_KEY || "unset",
  phoneNumberId: process.env.KAPSO_PHONE_NUMBER_ID || "unset",
  webhookSecret: process.env.KAPSO_WEBHOOK_SECRET || "unset",
});

export const { bot, channel, send } = chatSdkChannel({
  userName: "bridgr",
  adapters: { kapso },
  state: createMemoryState(),
  // Hand every message to eve, even mid-reply, so eve can steer the running turn.
  concurrency: "concurrent",
  // WhatsApp can't edit sent messages, so send each reply whole.
  streaming: false,
});

// Every WhatsApp chat is a DM. bridgr only ever talks to its owner.
bot.onDirectMessage(async (thread: Thread, message: Message) => {
  if (!isOwner(message.author.userId)) return;
  await thread.subscribe();
  await send(messageToUserContent(message), { thread, title: "WhatsApp" });
});

export default channel;
