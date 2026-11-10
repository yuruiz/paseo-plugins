import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { st } from "../i18n";
import { join } from "node:path";
import { parseHostsConfig, type HostConfig } from "./ssh";

/** The shape the settings UI submits. `password` semantics:
 *  - undefined: keep the stored password for this host name
 *  - "": clear the stored password
 *  - non-empty: set a new password
 */
export interface HostForm {
  name: string;
  originalName?: string | null;
  target: string;
  enabled: boolean;
  port: number | null;
  identityFile: string;
  passwordCommand: string;
  nodePath: string;
  cacheDir: string;
  timeoutMs: number | null;
  password?: string;
}

function trimOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export async function readHostsFile(dir: string): Promise<HostConfig[]> {
  try {
    return parseHostsConfig(await readFile(join(dir, "hosts.json"), "utf8"));
  } catch {
    return [];
  }
}

export function applyHostForms(existing: HostConfig[], forms: HostForm[]): { hosts: HostConfig[]; error: string | null } {
  const seen = new Set<string>();
  const hosts: HostConfig[] = [];
  for (const form of forms) {
    const name = form.name.trim();
    const target = form.target.trim();
    if (!name || !target) return { hosts: [], error: st("每台主机都需要填写名称和地址（target）", "Each host needs a name and a target") };
    if (target.startsWith("-")) return { hosts: [], error: st("主机地址不能以 - 开头", "A host target cannot start with -") };
    if (seen.has(name)) return { hosts: [], error: st(`主机名重复：${name}`, `Duplicate host name: ${name}`) };
    seen.add(name);
    const previousName = form.originalName?.trim() || name;
    const previous = existing.find((host) => host.name === previousName);
    const passwordCommand = trimOrUndefined(form.passwordCommand);
    let password: string | undefined;
    if (form.password === undefined) password = previous?.password;
    else if (form.password === "") password = undefined;
    else password = form.password;
    if (passwordCommand) password = undefined;
    hosts.push({
      name,
      target,
      enabled: form.enabled !== false,
      port: form.port ?? undefined,
      identityFile: trimOrUndefined(form.identityFile),
      password,
      passwordCommand,
      nodePath: trimOrUndefined(form.nodePath),
      cacheDir: trimOrUndefined(form.cacheDir),
      timeoutMs: form.timeoutMs ?? undefined,
    });
  }
  return { hosts, error: null };
}

export async function writeHostsFile(dir: string, hosts: HostConfig[]): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {});
  const file = join(dir, "hosts.json");
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  const serialized = hosts.map((host) => ({
    name: host.name,
    target: host.target,
    enabled: host.enabled,
    ...(host.port ? { port: host.port } : {}),
    ...(host.identityFile ? { identityFile: host.identityFile } : {}),
    ...(host.password ? { password: host.password } : {}),
    ...(host.passwordCommand ? { passwordCommand: host.passwordCommand } : {}),
    ...(host.nodePath ? { nodePath: host.nodePath } : {}),
    ...(host.cacheDir ? { cacheDir: host.cacheDir } : {}),
    ...(host.timeoutMs ? { timeoutMs: host.timeoutMs } : {}),
  }));
  await writeFile(temporary, JSON.stringify(serialized, null, 2), { mode: 0o600 });
  await rename(temporary, file);
  await chmod(file, 0o600).catch(() => {});
}
