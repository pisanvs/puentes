import { defineSchedule } from "eve/schedules";
import { spawnPipeline } from "../lib/spawn-pipeline";

// Collection needs the owner's logged-in local browser, so this only does
// anything useful where `eve dev` / `eve start` runs on the owner's machine.
export default defineSchedule({
  cron: "0 3 * * *",
  run() {
    spawnPipeline({ collect: true });
  },
});
