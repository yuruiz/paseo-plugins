import type { PluginServerContext } from "@getpaseo/plugin/server";
import { contributeScheduler } from "./server/plugin";

export default function contribute(server: PluginServerContext) {
  return contributeScheduler(server);
}
