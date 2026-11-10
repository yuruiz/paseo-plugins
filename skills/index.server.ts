import type { PluginServerContext } from "@getpaseo/plugin/server";

import { createListSkillsHandler, createReadSkillHandler } from "./server/skills";
import { listSkills, readSkill } from "./shared/skills";
import { compareSkills, syncSkills, syncPreferences, syncStatus } from "./shared/sync";
import { SkillSync } from "./server/sync";
import { SyncJobs } from "./server/sync-jobs";
import { SyncGitHub, githubRequest } from "./server/sync-github";

export default function contribute(server: PluginServerContext) {
  const controller = new AbortController();
  const sync = new SkillSync(new SyncGitHub(githubRequest(controller.signal)));
  const jobs = new SyncJobs(sync);
  server.registerSettings(syncPreferences);
  server.handle(compareSkills, (input, context) => sync.compare(input, context));
  server.handle(syncSkills, (input, context) => jobs.start(input, context));
  server.handle(syncStatus, (input) => jobs.status(input));
  server.handle(listSkills, createListSkillsHandler());
  server.handle(readSkill, createReadSkillHandler());
  return () => controller.abort();
}
