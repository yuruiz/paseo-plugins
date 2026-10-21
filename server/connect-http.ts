import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { z } from "zod";
import { ConnectError } from "./errors.js";

interface ConnectRequest {
  url: string;
  method: "GET" | "POST" | "PUT";
  body: unknown;
  token: string;
  proxyUrl: string | null;
  signal: AbortSignal;
}

function createAgent({ url, proxyUrl, signal }: ConnectRequest) {
  if (!proxyUrl) return false;
  const proxy = new URL(proxyUrl);
  if (proxy.protocol.startsWith("socks5")) {
    return new SocksProxyAgent(proxy, { timeout: 30_000, socketOptions: { signal } });
  }
  if (new URL(url).protocol === "https:") return new HttpsProxyAgent(proxy, { signal });
  return new HttpProxyAgent(proxy, { signal });
}

export async function requestConnect(input: ConnectRequest) {
  const agent = createAgent(input);
  const request = new URL(input.url).protocol === "https:" ? httpsRequest : httpRequest;
  const body = input.method === "GET" ? undefined : JSON.stringify(input.body);
  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const outgoing = request(
        input.url,
        {
          method: input.method,
          agent,
          signal: input.signal,
          headers: {
            Authorization: `Bearer ${input.token}`,
            "Content-Type": "application/json",
            ...(body === undefined ? {} : { "Content-Length": Buffer.byteLength(body) }),
          },
        },
        resolve,
      );
      outgoing.once("error", reject);
      outgoing.end(body);
    });
    const status = response.statusCode;
    if (status === undefined || status < 200 || status >= 300) {
      response.destroy();
      throw new ConnectError(
        `1Password Connect returned HTTP ${status ?? "unknown"}. Check token permissions, proxy and vault/item IDs.`,
      );
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 2 * 1024 * 1024) {
        response.destroy();
        throw new ConnectError("1Password Connect response exceeds 2 MiB.");
      }
      chunks.push(buffer);
    }
    return z.json().parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally {
    if (agent) agent.destroy();
  }
}
