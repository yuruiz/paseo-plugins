import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { settingsRpc } from "@getpaseo/plugin";
import { defineConfig } from "vite";
import { fileCapabilities } from "../../server/files";
import { mermaidRuntime } from "../../server/generated/mermaid";
import { GitChangesService } from "../../server/service";
import { compareFileDiffRpc, compareRpc } from "../../shared/compare-contracts";
import {
  changesRpc,
  fileCapabilitiesRpc,
  fileContentRpc,
  fileDiffRpc,
  mermaidRuntimeRpc,
  resolveLinkRpc,
  revealFileRpc,
} from "../../shared/contracts";
import { commitFileDiffRpc, commitRpc, historyRpc } from "../../shared/history-contracts";
import { defaultSettings, panelSettingsSchema } from "../../shared/settings";

const service = new GitChangesService();
const directory = process.env.PASEO_DIFF_ACCEPTANCE_DIRECTORY;
const settingsContracts = settingsRpc("git-panel");
const settingsPath = resolve(import.meta.dirname, "../../.cache/preview-settings.json");
let stored = { revision: "0", values: defaultSettings };
try {
  const data = JSON.parse(await readFile(settingsPath, "utf8"));
  stored = { revision: String(data.revision), values: panelSettingsSchema.parse(data.values) };
} catch {}
export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: [
      { find: /^@getpaseo\/plugin\/client$/, replacement: resolve(import.meta.dirname, "host.ts") },
      {
        find: /^@getpaseo\/plugin\/client\/react-native$/,
        replacement: resolve(import.meta.dirname, "native.ts"),
      },
      { find: /^react-native$/, replacement: "react-native-web" },
    ],
  },
  define: { "process.env.NODE_ENV": JSON.stringify("development"), __DEV__: "true" },
  server: {
    host: "127.0.0.1",
    port: 4178,
    strictPort: true,
    fs: { allow: [resolve(import.meta.dirname, "../..")] },
  },
  plugins: [
    {
      name: "git-acceptance-rpc",
      configureServer(server) {
        server.httpServer?.on("close", () => service.close());
        server.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith("/api/")) return next();
          response.setHeader("content-type", "application/json");
          try {
            if (!directory)
              throw new Error("Set PASEO_DIFF_ACCEPTANCE_DIRECTORY before starting the preview.");
            if (request.url === "/api/info") {
              response.end(JSON.stringify({ directory }));
              return;
            }
            if (request.url !== "/api/rpc" || request.method !== "POST") {
              response.statusCode = 404;
              response.end("{}");
              return;
            }
            let body = "";
            for await (const chunk of request) {
              body += String(chunk);
              if (body.length > 65536) throw new Error("Request too large");
            }
            const input = JSON.parse(body) as { name: string; input: unknown };
            if (input.name === settingsContracts.read.name) {
              response.end(JSON.stringify({ data: { status: "ready", ...stored } }));
              return;
            }
            if (input.name === settingsContracts.write.name) {
              const args = settingsContracts.write.input.parse(input.input);
              if (args.revision !== stored.revision) {
                response.end(
                  JSON.stringify({ data: { status: "conflict", error: "Settings conflict" } }),
                );
                return;
              }
              stored = {
                revision: String(Number(stored.revision) + 1),
                values: panelSettingsSchema.parse(args.values),
              };
              await mkdir(resolve(settingsPath, ".."), { recursive: true });
              await writeFile(settingsPath, JSON.stringify(stored));
              response.end(JSON.stringify({ data: { status: "saved", ...stored } }));
              return;
            }
            if (input.name === fileCapabilitiesRpc.name) {
              response.end(JSON.stringify({ data: fileCapabilities() }));
              return;
            }
            if (input.name === mermaidRuntimeRpc.name) {
              response.end(JSON.stringify({ data: mermaidRuntime }));
              return;
            }
            if (input.name === changesRpc.name) {
              const args = changesRpc.input.parse(input.input);
              if (resolve(args.directory) !== resolve(directory))
                throw new Error("Unexpected acceptance directory");
              response.end(JSON.stringify({ data: await service.snapshot(args) }));
              return;
            }
            if (input.name === resolveLinkRpc.name) {
              const args = resolveLinkRpc.input.parse(input.input);
              if (resolve(args.directory) !== resolve(directory))
                throw new Error("Unexpected acceptance directory");
              response.end(JSON.stringify({ data: await service.resolveLink(args) }));
              return;
            }
            for (const [contract, handler] of [
              [compareRpc, (args: unknown) => service.compare(compareRpc.input.parse(args))],
              [
                compareFileDiffRpc,
                (args: unknown) => service.compareDiff(compareFileDiffRpc.input.parse(args)),
              ],
              [historyRpc, (args: unknown) => service.history(historyRpc.input.parse(args))],
              [commitRpc, (args: unknown) => service.commit(commitRpc.input.parse(args))],
              [
                commitFileDiffRpc,
                (args: unknown) => service.commitDiff(commitFileDiffRpc.input.parse(args)),
              ],
            ] as const) {
              if (input.name !== contract.name) continue;
              const args = contract.input.parse(input.input);
              if (resolve(args.directory) !== resolve(directory))
                throw new Error("Unexpected acceptance directory");
              response.end(JSON.stringify({ data: await handler(args) }));
              return;
            }
            const args = fileContentRpc.input.parse(input.input);
            if (resolve(args.directory) !== resolve(directory))
              throw new Error("Unexpected acceptance directory");
            let data: unknown;
            if (input.name === fileDiffRpc.name)
              data = await service.diff(fileDiffRpc.input.parse(input.input));
            else if (input.name === fileContentRpc.name) data = await service.content(args);
            else if (input.name === revealFileRpc.name) data = await service.reveal(args);
            else throw new Error("Unknown RPC");
            response.end(JSON.stringify({ data }));
          } catch (error) {
            response.statusCode = 400;
            response.end(
              JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            );
          }
        });
      },
    },
  ],
});
