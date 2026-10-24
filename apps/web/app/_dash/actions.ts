"use server";

import { revalidatePath } from "next/cache";
import {
  addNote,
  getNudges,
  logContact,
  removeObjective,
  resetRanking,
  setMatchStatus,
  setNudgeStatus,
  setObjective,
  setInnerCircle,
  setPinned,
  addWarmthBoost,
  snoozeNudge,
} from "@agent/lib/queries";
import { browserDaemonUp, ensureBrowserDaemon, VIEW_PORT } from "@agent/lib/browserd";
import { saveAccount } from "@agent/lib/contacts";
import { type EntityKind, peopleAt } from "@agent/lib/graph/query";
import { readJob, spawnJob } from "@agent/lib/jobs";
import { answerMet } from "@agent/lib/new-people";
import { trackTop } from "@agent/lib/pipeline/prioritize";
import { spawnPipeline } from "@agent/lib/spawn-pipeline";

const refreshAll = () => revalidatePath("/", "layout");

export async function closeNudge(nudgeId: number, outcome: "done" | "dismissed") {
  await setNudgeStatus(nudgeId, outcome);
  refreshAll();
}

export async function snooze(nudgeId: number, days: number) {
  await snoozeNudge(nudgeId, days);
  refreshAll();
}

export async function closeMatch(matchId: number, outcome: "done" | "dismissed") {
  await setMatchStatus(matchId, outcome);
  refreshAll();
}

export async function saveNote(name: string, note: string) {
  await addNote(name, note);
  refreshAll();
}

export async function markContacted(name: string) {
  await logContact(name, 0);
  refreshAll();
}

export async function saveObjective(text: string, weight: number, id?: number) {
  await setObjective(text, weight, id);
  await resetRanking();
  refreshAll();
}

export async function deleteObjective(id: number) {
  await removeObjective(id);
  await resetRanking();
  refreshAll();
}

export type { JobStatus as PipelineStatus } from "@agent/lib/jobs";

export async function pipelineStatus() {
  return readJob("pipeline");
}

/** Kick off a refresh. `collect` scrapes socials first (minutes); otherwise only re-ranks (seconds). */
export async function startRefresh(collect: boolean) {
  return spawnPipeline({ collect });
}

export async function jobStatus(name: string) {
  return readJob(name);
}

/** Start the shared browser (if needed) so the dashboard's live view can connect. */
export async function startBrowser() {
  await ensureBrowserDaemon();
  return { viewUrl: `ws://127.0.0.1:${VIEW_PORT}` };
}

export async function browserRunning() {
  return browserDaemonUp();
}

/** Open the platform's login page in the shared browser; you sign in via the live view. */
export async function connectPlatform(platform: "x" | "linkedin" | "instagram") {
  await ensureBrowserDaemon();
  return spawnJob(`connect-${platform}`, "scripts/connect.ts", [platform], { browser: true });
}

export async function importFollowing(platform: "x" | "linkedin" | "bluesky" | "instagram") {
  return spawnJob(`import-${platform}`, "scripts/import.ts", [platform], { browser: platform !== "bluesky" });
}

export async function setBlueskyHandle(handle: string) {
  await saveAccount("bluesky", { handle: handle.trim().replace(/^@/, ""), connectedAt: Date.now() });
  refreshAll();
}

export async function queryGraph(query: string, kind?: EntityKind) {
  return peopleAt(query, kind, 80);
}

export async function answerMetInPerson(personId: number, answer: "met" | "online" | "skip", where?: string) {
  await answerMet(personId, answer, where);
  refreshAll();
}

export async function mapMoreNetwork(count: number) {
  return spawnJob("graph", "scripts/graph.ts", [String(count)]);
}

export async function track(personId: number, tracked: boolean) {
  await setInnerCircle(personId, tracked);
  refreshAll();
}

export async function togglePin(personId: number, pinned: boolean) {
  await setPinned(personId, pinned);
  refreshAll();
}

/** Apply accumulated "love taps". The client debounces spam-clicks into one call. */
export async function bumpWarmth(personId: number, amount: number) {
  return addWarmthBoost(personId, amount);
}

export async function addTopSuggestions(n: number) {
  const added = await trackTop(n);
  refreshAll();
  return added;
}

/** Lightweight feed for desktop alerts: ids are stable, so the client can tell what's new. */
export async function inboxPulse() {
  const nudges = await getNudges(20);
  return nudges.map((n) => ({ id: n.nudgeId, person: n.person, reason: n.reason }));
}
