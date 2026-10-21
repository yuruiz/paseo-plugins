import { constants } from "node:fs";
import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  connectConfigurationSchema,
  connectProxySchema,
  connectIdSchema,
  connectVaultSchema,
  connectItemSummarySchema,
} from "../shared/onepassword.js";

import { ConnectError } from "./errors.js";
import { requestConnect } from "./connect-http.js";

const storedConfigurationSchema = connectConfigurationSchema.extend({
  version: z.literal(1),
  enabled: z.boolean(),
});
type StoredConfiguration = z.infer<typeof storedConfigurationSchema>;

export class OnePasswordConnect {
  private readonly active = new Set<AbortController>();
  private configuration: StoredConfiguration | null = null;
  private loadError: string | null = null;
  private writes: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(private readonly directory: string) {}

  static async open(directory: string) {
    const connect = new OnePasswordConnect(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    try {
      const file = await open(connect.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > 128 * 1024)
          throw new ConnectError("Invalid configuration file.");
        await file.chmod(0o600);
        const text = await file.readFile("utf8");
        connect.configuration = storedConfigurationSchema.parse(JSON.parse(text));
      } finally {
        await file.close();
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        connect.loadError = "Stored Connect configuration could not be read. Replace or delete it.";
      }
    }
    return connect;
  }

  private get file() {
    return path.join(this.directory, "configuration.json");
  }

  private enqueue(operation: () => Promise<void>) {
    if (this.closed) return Promise.reject(new ConnectError("Connect is stopped."));
    const next = this.writes.then(operation);
    this.writes = next.catch(() => undefined);
    return next;
  }

  private abortRequests() {
    for (const controller of this.active) controller.abort();
    this.active.clear();
  }

  private async persist(next: StoredConfiguration) {
    const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(next), "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.file);
    } catch {
      throw new ConnectError(
        "Could not save Connect configuration. Check host storage permissions.",
      );
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    this.abortRequests();
    this.configuration = next;
    this.loadError = null;
  }

  configure(input: z.input<typeof connectConfigurationSchema>) {
    const parsed = connectConfigurationSchema.safeParse(input);
    if (!parsed.success) return Promise.reject(new ConnectError("Invalid Connect URL or token."));
    return this.enqueue(() => this.persist({ ...parsed.data, version: 1, enabled: true }));
  }

  setProxy(proxyUrl: z.infer<typeof connectProxySchema>) {
    const parsed = connectProxySchema.safeParse(proxyUrl);
    if (!parsed.success) return Promise.reject(new ConnectError("Invalid Connect proxy URL."));
    return this.enqueue(async () => {
      if (!this.configuration) throw new ConnectError("Configure 1Password Connect first.");
      await this.persist({ ...this.configuration, proxyUrl: parsed.data });
    });
  }

  setEnabled(enabled: boolean) {
    return this.enqueue(async () => {
      if (!this.configuration) throw new ConnectError("Configure 1Password Connect first.");
      await this.persist({ ...this.configuration, enabled });
    });
  }

  remove() {
    return this.enqueue(async () => {
      try {
        await rm(this.file, { force: true });
      } catch {
        throw new ConnectError(
          "Could not delete Connect configuration. Check host storage permissions.",
        );
      }
      this.abortRequests();
      this.configuration = null;
      this.loadError = null;
    });
  }

  async close() {
    this.closed = true;
    this.abortRequests();
    await this.writes;
    this.configuration = null;
  }

  status() {
    return {
      configured: this.configuration !== null,
      proxyUrl: this.configuration?.proxyUrl ?? null,
      enabled: this.configuration?.enabled ?? false,
      url: this.configuration?.url ?? null,
      error: this.loadError,
    };
  }

  private async readForClient(route: string) {
    const configuration = this.configuration;
    if (!configuration || this.closed) throw new ConnectError("Configure 1Password Connect first.");
    return this.perform(configuration, "GET", route, undefined, new AbortController().signal);
  }

  async listVaults() {
    const result = await this.readForClient("vaults");
    const vaults = z.array(connectVaultSchema).safeParse(result);
    if (!vaults.success) throw new ConnectError("Connect returned an invalid vault list.");
    return vaults.data;
  }

  async listItems(input: { vaultId: string }) {
    const vaultId = connectIdSchema.safeParse(input.vaultId);
    if (!vaultId.success) throw new ConnectError("Invalid vault ID.");
    const result = await this.readForClient(`vaults/${vaultId.data}/items`);
    // Strip everything outside list metadata before it crosses the client RPC boundary.
    const items = z.array(connectItemSummarySchema).safeParse(result);
    if (!items.success) throw new ConnectError("Connect returned an invalid item list.");
    return items.data;
  }

  async test() {
    const result = await this.readForClient("vaults");
    const vaults = z.array(z.object({ id: z.string() })).safeParse(result);
    if (!vaults.success) throw new ConnectError("Connect returned an invalid vault list.");
    return { vaultCount: vaults.data.length };
  }

  async request(method: "GET" | "POST" | "PUT", route: string, body: unknown, signal: AbortSignal) {
    const configuration = this.configuration;
    if (!configuration || this.closed)
      throw new ConnectError("Configure 1Password Connect in Secrets first.");
    if (!configuration.enabled) throw new ConnectError("1Password Connect access is disabled.");
    return this.perform(configuration, method, route, body, signal);
  }

  private async perform(
    configuration: StoredConfiguration,
    method: "GET" | "POST" | "PUT",
    route: string,
    body: unknown,
    signal: AbortSignal,
  ) {
    const url = `${configuration.url.replace(/\/+$/, "")}/v1/${route}`;
    const controller = new AbortController();
    this.active.add(controller);
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    const timeout = setTimeout(cancel, 30_000);
    try {
      return await requestConnect({
        url,
        method,
        body,
        token: configuration.token,
        proxyUrl: configuration.proxyUrl,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof ConnectError) throw error;
      throw new ConnectError(
        "1Password Connect request failed. Check connectivity, proxy and configuration.",
      );
    } finally {
      this.active.delete(controller);
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
    }
  }
}

const id = connectIdSchema;
const itemSchema = z
  .object({ title: z.string().min(1), category: z.string().min(1) })
  .catchall(z.json());

export function registerConnectTools(mcp: McpServer, connect: OnePasswordConnect) {
  async function call(
    method: "GET" | "POST" | "PUT",
    route: string,
    body: unknown,
    signal: AbortSignal,
  ) {
    try {
      const result = await connect.request(method, route, body, signal);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (error) {
      const message =
        error instanceof ConnectError ? error.message : "1Password Connect request failed.";
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  }
  mcp.registerTool(
    "onepassword_list_vaults",
    {
      description: "List vaults accessible to the configured 1Password Connect token.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (_, { signal }) => call("GET", "vaults", undefined, signal),
  );
  mcp.registerTool(
    "onepassword_list_items",
    {
      description:
        'List item metadata in a Connect vault. Optional SCIM filter: title eq "name" or tag eq "tag".',
      inputSchema: { vaultId: id, filter: z.string().max(1024).optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ vaultId, filter }, { signal }) => {
      const query = filter ? `?filter=${encodeURIComponent(filter)}` : "";
      return call("GET", `vaults/${vaultId}/items${query}`, undefined, signal);
    },
  );
  mcp.registerTool(
    "onepassword_get_item",
    {
      description:
        "Read a complete Connect item, including secret field values. Values returned by this tool enter the agent context.",
      inputSchema: { vaultId: id, itemId: id },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ vaultId, itemId }, { signal }) =>
      call("GET", `vaults/${vaultId}/items/${itemId}`, undefined, signal),
  );
  mcp.registerTool(
    "onepassword_create_item",
    {
      description:
        "Create an item in a Connect vault using a FullItem object (title, category, fields, sections, tags, urls). Returns the created item including values.",
      inputSchema: { vaultId: id, item: itemSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    ({ vaultId, item }, { signal }) =>
      call("POST", `vaults/${vaultId}/items`, { ...item, vault: { id: vaultId } }, signal),
  );
  mcp.registerTool(
    "onepassword_replace_item",
    {
      description:
        "Replace a complete Connect item. Read it first, preserve fields you want to keep, then submit the full edited object. Omitted fields may be removed. Returns the updated item including values.",
      inputSchema: { vaultId: id, itemId: id, item: itemSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    ({ vaultId, itemId, item }, { signal }) =>
      call(
        "PUT",
        `vaults/${vaultId}/items/${itemId}`,
        { ...item, id: itemId, vault: { id: vaultId } },
        signal,
      ),
  );
}
