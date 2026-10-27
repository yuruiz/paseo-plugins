import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SchedulerSurface } from "./client/main";

export default function contribute(client: PluginClientContext) {
  client.addSurface("scheduler", SchedulerSurface);
  client.addSidebarItem({
    id: "scheduler",
    title: "Advanced Schedules",
    icon: "CalendarClock",
    surface: "scheduler",
  });
  return () => {};
}
