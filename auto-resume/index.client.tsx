import type { PluginClientContext } from "@getpaseo/plugin/client";
import { cardSchema } from "./shared/contracts";
import { QuotaCard } from "./client/controls";
import { contributePills } from "./client/pills";
export default function contribute(client: PluginClientContext) {
  client.addTimelineRenderer({
    kind: "quota-resume",
    version: 1,
    schema: cardSchema,
    Component: QuotaCard,
  });
  return contributePills(client);
}
