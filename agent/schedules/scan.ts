import { defineSchedule } from "eve/schedules";
import { spawnPipeline } from "../lib/spawn-pipeline";

// The daytime "doom-scroll" agent: scrape the inner circle a few times through the day so today's
// edition stays current and new signals surface while they're fresh (the nightly refresh does the
// deep pass at 3am). New nudges it produces get pushed via desktop alerts + the morning digest.
// Collection drives the owner's logged-in local browser, so this only does real work where
// `eve dev` / `eve start` runs on the owner's machine.
export default defineSchedule({
  cron: "0 9-21/4 * * *", // ~9am, 1pm, 5pm, 9pm
  run() {
    spawnPipeline({ collect: true });
  },
});
