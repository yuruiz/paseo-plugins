import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { Pressable, Switch, Text, View } from "react-native";
import type { UsageHostListItem } from "../shared/usage";
import { usageHostsListRpc, usageHostsSetRpc, usageHostsTestRpc } from "../shared/usage";
import { useI18n } from "./i18n";

type Theme = PluginSurfaceProps["theme"];

interface HostDraft {
  originalName: string | null;
  name: string;
  target: string;
  enabled: boolean;
  port: string;
  identityFile: string;
  nodePath: string;
  cacheDir: string;
  timeoutSec: string;
  passwordMode: "key" | "password" | "command";
  password: string;
  hasPassword: boolean;
  passwordCommand: string;
}

interface TestResult {
  ok: boolean;
  detail: string;
}

function emptyDraft(): HostDraft {
  return {
    originalName: null,
    name: "",
    target: "",
    enabled: true,
    port: "",
    identityFile: "",
    nodePath: "",
    cacheDir: "",
    timeoutSec: "180",
    passwordMode: "key",
    password: "",
    hasPassword: false,
    passwordCommand: "",
  };
}

function draftFromHost(host: UsageHostListItem): HostDraft {
  return {
    originalName: host.name,
    name: host.name,
    target: host.target,
    enabled: host.enabled,
    port: host.port ? String(host.port) : "",
    identityFile: host.identityFile,
    nodePath: host.nodePath,
    cacheDir: host.cacheDir,
    timeoutSec: host.timeoutMs ? String(Math.round(host.timeoutMs / 1000)) : "180",
    passwordMode: host.passwordCommand ? "command" : host.hasPassword ? "password" : "key",
    password: "",
    hasPassword: host.hasPassword,
    passwordCommand: host.passwordCommand,
  };
}

/** Password semantics: undefined keeps the stored password; "" clears it; a value sets it. */
function draftPassword(draft: HostDraft): string | undefined {
  if (draft.passwordMode === "password") {
    if (draft.password.length > 0) return draft.password;
    return draft.hasPassword ? undefined : "";
  }
  // Command and key modes must not leave a stored password behind, otherwise it
  // keeps taking precedence over the newly selected authentication method.
  return "";
}

function draftToPayload(draft: HostDraft) {
  const port = Number.parseInt(draft.port, 10);
  const timeoutSec = Number.parseInt(draft.timeoutSec, 10);
  return {
    name: draft.name.trim(),
    originalName: draft.originalName,
    target: draft.target.trim(),
    enabled: draft.enabled,
    port: Number.isFinite(port) && port > 0 ? port : null,
    identityFile: draft.identityFile,
    passwordCommand: draft.passwordCommand,
    nodePath: draft.nodePath,
    cacheDir: draft.cacheDir,
    timeoutMs: Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : null,
    password: draftPassword(draft),
  };
}

export function HostsManager({ theme }: { theme: Theme }) {
  const queryClient = useQueryClient();
  const listCall = useRpc(usageHostsListRpc);
  const setCall = useRpc(usageHostsSetRpc);
  const testCall = useRpc(usageHostsTestRpc);
  const listQuery = useQuery({ queryKey: ["agent-usage-hosts"], queryFn: () => listCall({}) });
  const [draft, setDraft] = useState<HostDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  const styles = useMemo(
    () =>
      ({
        banner: { borderRadius: 10, padding: 10, backgroundColor: theme.colors.surface1 },
        bannerOk: { borderLeftWidth: 3, borderLeftColor: theme.colors.statusSuccess },
        bannerError: { borderLeftWidth: 3, borderLeftColor: theme.colors.statusDanger },
        bannerText: { fontSize: 11, color: theme.colors.foreground },
        section: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 10 },
        sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
        sectionTitle: { fontSize: 13, fontWeight: "600", color: theme.colors.foreground },
        footer: { fontSize: 10, color: theme.colors.foregroundMuted },
        hostCard: { gap: 6, padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface0 },
        hostHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
        hostName: { fontSize: 12, fontWeight: "600", color: theme.colors.foreground },
        hostTarget: { fontSize: 11, color: theme.colors.foregroundMuted, flex: 1, textAlign: "right" },
        hostMeta: { fontSize: 10, color: theme.colors.foregroundMuted },
        buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
        smallButton: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: theme.colors.surface1 },
        smallButtonText: { fontSize: 11, color: theme.colors.foreground },
        smallButtonDangerText: { fontSize: 11, color: theme.colors.statusDanger },
        primaryButton: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: theme.colors.accent },
        primaryButtonText: { fontSize: 12, color: theme.colors.accentForeground, fontWeight: "600" },
        field: { gap: 4 },
        row2: { flexDirection: "row", gap: 8 },
        flexField: { flex: 1, gap: 4 },
        fieldLabel: { fontSize: 11, color: theme.colors.foregroundMuted },
        input: {
          fontSize: 12,
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface0,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        chipRow: { flexDirection: "row", gap: 6 },
        chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: theme.colors.surface0 },
        chipActive: { backgroundColor: theme.colors.accent },
        chipText: { fontSize: 11, color: theme.colors.foregroundMuted },
        chipTextActive: { color: theme.colors.accentForeground },
        testResult: { fontSize: 10, lineHeight: 14 },
        testOk: { color: theme.colors.statusSuccess },
        testError: { color: theme.colors.statusDanger },
      }) satisfies Record<string, ViewStyle | TextStyle>,
    [theme],
  );

  const { t } = useI18n();
  const hosts = listQuery.data?.hosts ?? [];

  const persist = async (drafts: HostDraft[]): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await setCall({ hosts: drafts.map(draftToPayload) });
      if (result.saved) {
        setMessage({ kind: "ok", text: t("hosts.saved") });
        await queryClient.invalidateQueries({ queryKey: ["agent-usage-hosts"] });
        return true;
      }
      setMessage({ kind: "error", text: result.error ?? t("common.saveFailed") });
      return false;
    } catch (error) {
      setMessage({ kind: "error", text: t("common.saveFailedDetail", { message: error instanceof Error ? error.message : String(error) }) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim() || !draft.target.trim()) {
      setMessage({ kind: "error", text: t("hosts.needNameTarget") });
      return;
    }
    const others = hosts.filter((host) => host.name !== (draft.originalName ?? draft.name)).map(draftFromHost);
    if (await persist([...others, draft])) setDraft(null);
  };

  const removeHost = async (name: string) => {
    const next = hosts.filter((host) => host.name !== name).map(draftFromHost);
    if (await persist(next)) {
      setTestResults((previous) => {
        const copy = { ...previous };
        delete copy[name];
        return copy;
      });
    }
  };

  const toggleEnabled = async (host: UsageHostListItem, value: boolean) => {
    const next = hosts.map((item) => (item.name === host.name ? { ...draftFromHost(item), enabled: value } : draftFromHost(item)));
    await persist(next);
  };

  const runTest = async (draftValue: HostDraft, key: string) => {
    if (testing) return;
    setTesting(key);
    try {
      const result = await testCall({ host: draftToPayload(draftValue) });
      setTestResults((previous) => ({ ...previous, [key]: result }));
    } catch (error) {
      setTestResults((previous) => ({ ...previous, [key]: { ok: false, detail: error instanceof Error ? error.message : String(error) } }));
    } finally {
      setTesting(null);
    }
  };

  const field = (label: string, node: ReactNode) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {node}
    </View>
  );

  const renderTestResult = (result: TestResult | undefined) =>
    result ? (
      <Text style={[styles.testResult, result.ok ? styles.testOk : styles.testError]}>
        {result.ok ? "✓ " : "✗ "}
        {result.detail}
      </Text>
    ) : null;

  return (
    <>
      {message ? (
        <View style={[styles.banner, message.kind === "ok" ? styles.bannerOk : styles.bannerError]}>
          <Text style={styles.bannerText}>{message.text}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t("hosts.title")}</Text>
          <Pressable
            style={styles.smallButton}
            onPress={() => {
              setDraft(emptyDraft());
              setMessage(null);
            }}
          >
            <Text style={styles.smallButtonText}>{t("hosts.add")}</Text>
          </Pressable>
        </View>
        {hosts.length === 0 ? (
          <Text style={styles.footer}>{t("hosts.empty")}</Text>
        ) : null}
        {hosts.map((host) => (
          <View key={host.name} style={styles.hostCard}>
            <View style={styles.hostHeader}>
              <Switch value={host.enabled} onValueChange={(value) => void toggleEnabled(host, value)} />
              <Text style={styles.hostName}>{host.name}</Text>
              <Text style={styles.hostTarget} numberOfLines={1}>
                {host.target}
                {host.port ? `:${host.port}` : ""}
              </Text>
            </View>
            <Text style={styles.hostMeta} numberOfLines={1}>
              {host.passwordCommand ? t("hosts.auth.passwordCommand") : host.hasPassword ? t("hosts.auth.password") : t("hosts.auth.key")}
              {host.nodePath ? ` · node: ${host.nodePath}` : ""}
              {host.cacheDir ? ` · cache: ${host.cacheDir}` : ""}
            </Text>
            <View style={styles.buttonRow}>
              <Pressable style={styles.smallButton} disabled={testing === host.name} onPress={() => void runTest(draftFromHost(host), host.name)}>
                <Text style={styles.smallButtonText}>{testing === host.name ? t("common.testing") : t("common.test")}</Text>
              </Pressable>
              <Pressable
                style={styles.smallButton}
                onPress={() => {
                  setDraft(draftFromHost(host));
                  setMessage(null);
                }}
              >
                <Text style={styles.smallButtonText}>{t("common.edit")}</Text>
              </Pressable>
              <Pressable style={styles.smallButton} onPress={() => void removeHost(host.name)}>
                <Text style={styles.smallButtonDangerText}>{t("common.delete")}</Text>
              </Pressable>
            </View>
            {renderTestResult(testResults[host.name])}
          </View>
        ))}
      </View>

      {draft ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{draft.originalName ? t("hosts.edit", { name: draft.originalName }) : t("hosts.add")}</Text>
          {field(
            t("hosts.nameLabel"),
            <TextInput
              style={styles.input}
              value={draft.name}
              onChangeText={(value) => setDraft({ ...draft, name: value })}
              placeholder="dev1"
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />,
          )}
          {field(
            t("hosts.targetLabel"),
            <TextInput
              style={styles.input}
              value={draft.target}
              onChangeText={(value) => setDraft({ ...draft, target: value })}
              placeholder={t("hosts.targetPlaceholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />,
          )}
          <View style={styles.row2}>
            <View style={styles.flexField}>
              <Text style={styles.fieldLabel}>{t("hosts.portLabel")}</Text>
              <TextInput
                style={styles.input}
                value={draft.port}
                onChangeText={(value) => setDraft({ ...draft, port: value })}
                placeholder="22"
                placeholderTextColor={theme.colors.foregroundMuted}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.flexField}>
              <Text style={styles.fieldLabel}>{t("hosts.timeoutLabel")}</Text>
              <TextInput
                style={styles.input}
                value={draft.timeoutSec}
                onChangeText={(value) => setDraft({ ...draft, timeoutSec: value })}
                placeholder="180"
                placeholderTextColor={theme.colors.foregroundMuted}
                keyboardType="number-pad"
              />
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t("hosts.authLabel")}</Text>
            <View style={styles.chipRow}>
              {(
                [
                  { mode: "key", label: t("hosts.auth.key") },
                  { mode: "password", label: t("hosts.auth.password") },
                  { mode: "command", label: t("hosts.auth.passwordCommand") },
                ] as const
              ).map((item) => {
                const active = draft.passwordMode === item.mode;
                return (
                  <Pressable
                    key={item.mode}
                    onPress={() => setDraft({ ...draft, passwordMode: item.mode })}
                    style={active ? [styles.chip, styles.chipActive] : styles.chip}
                  >
                    <Text style={active ? [styles.chipText, styles.chipTextActive] : styles.chipText}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {draft.passwordMode === "password"
            ? field(
                draft.hasPassword ? t("hosts.passwordSaved") : t("hosts.password"),
                <TextInput
                  style={styles.input}
                  value={draft.password}
                  onChangeText={(value) => setDraft({ ...draft, password: value })}
                  placeholder={draft.hasPassword ? "••••••••" : t("hosts.passwordPlaceholder")}
                  placeholderTextColor={theme.colors.foregroundMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />,
              )
            : null}
          {draft.passwordMode === "command"
            ? field(
                t("hosts.passwordCommandLabel"),
                <TextInput
                  style={styles.input}
                  value={draft.passwordCommand}
                  onChangeText={(value) => setDraft({ ...draft, passwordCommand: value })}
                  placeholder="security find-generic-password -s agent-usage-ssh-dev1 -w"
                  placeholderTextColor={theme.colors.foregroundMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />,
              )
            : null}
          {field(
            t("hosts.identityLabel"),
            <TextInput
              style={styles.input}
              value={draft.identityFile}
              onChangeText={(value) => setDraft({ ...draft, identityFile: value })}
              placeholder="~/.ssh/id_rsa"
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />,
          )}
          {field(
            t("hosts.nodePathLabel"),
            <TextInput
              style={styles.input}
              value={draft.nodePath}
              onChangeText={(value) => setDraft({ ...draft, nodePath: value })}
              placeholder="node"
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />,
          )}
          {field(
            t("hosts.cacheDirLabel"),
            <TextInput
              style={styles.input}
              value={draft.cacheDir}
              onChangeText={(value) => setDraft({ ...draft, cacheDir: value })}
              placeholder="~/.cache/agent-usage-plugin"
              placeholderTextColor={theme.colors.foregroundMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />,
          )}
          <View style={styles.buttonRow}>
            <Pressable style={styles.primaryButton} disabled={busy} onPress={() => void saveDraft()}>
              <Text style={styles.primaryButtonText}>{busy ? t("common.saving") : t("common.save")}</Text>
            </Pressable>
            <Pressable style={styles.smallButton} disabled={testing === "draft"} onPress={() => void runTest(draft, "draft")}>
              <Text style={styles.smallButtonText}>{testing === "draft" ? t("common.testing") : t("common.test")}</Text>
            </Pressable>
            <Pressable
              style={styles.smallButton}
              onPress={() => {
                setDraft(null);
                setMessage(null);
              }}
            >
              <Text style={styles.smallButtonText}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
          {renderTestResult(testResults["draft"])}
        </View>
      ) : null}

      <Text style={styles.footer}>
        {t("hosts.notes1")}
        {"\n"}
        {t("hosts.notes2")}
      </Text>
    </>
  );
}
