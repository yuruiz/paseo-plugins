import { type PluginHostProps, useAgent, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { compareSkills, syncPreferences, syncSkills, syncStatus, SyncConfig } from "../shared/sync";
import { canSync, statusLabels, type Direction } from "./sync-selection";

export function SyncPanel({
  agentId,
  theme,
  compact,
}: {
  agentId: string;
  theme: PluginHostProps["theme"];
  compact: boolean;
}) {
  const settings = useSettings(syncPreferences);
  const compare = useRpc(compareSkills);
  const sync = useRpc(syncSkills);
  const status = useRpc(syncStatus);
  const queries = useQueryClient();
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const [draft, setDraft] = useState<{
    repository: string;
    branch: string;
    revision: string;
  } | null>(null);
  const [direction, setDirection] = useState<Direction>("upload");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const running = useRef(false);
  const seenJob = useRef<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const config = settings.status === "ready" ? settings.values : null;
  const configured = config !== null && SyncConfig.safeParse(config).success;
  const job = useQuery({
    queryKey: ["skills-sync-job", agentId],
    queryFn: () => status({ agentId }),
    enabled: cwd != null,
    retry: false,
    refetchInterval: (query) => (query.state.data?.state === "running" ? 1000 : false),
  });
  const busy = starting || job.data?.state === "running";
  const query = useQuery({
    queryKey: ["skills-sync", agentId, cwd, config?.repository, config?.branch],
    queryFn: () => compare({ agentId, repository: config!.repository, branch: config!.branch }),
    enabled: configured && cwd != null && !busy && !job.isPending && draft === null,
    retry: false,
    staleTime: 60_000,
    refetchInterval: busy || draft ? false : 5 * 60_000,
  });
  useEffect(() => {
    setSelected([]);
    setConfirm(false);
  }, [query.data?.token, direction, agentId, cwd]);
  useEffect(() => {
    const finished = job.data;
    if (finished?.state !== "finished" || !finished.result || seenJob.current === finished.jobId)
      return;
    seenJob.current = finished.jobId;
    const result = finished.result;
    setMessage(
      `${result.completed.length} skill(s) ${finished.direction === "upload" ? "uploaded" : "downloaded"}.${result.backups.length ? ` Backups: ${result.backups.join(", ")}` : ""}`,
    );
    setError(result.error);
    setSelected([]);
    setConfirm(false);
    void queries.invalidateQueries({ queryKey: ["skills"] });
    void queries.invalidateQueries({ queryKey: ["skill"] });
    void queries.invalidateQueries({ queryKey: ["skills-sync", agentId] });
  }, [job.data, agentId, queries]);
  const colors = theme.colors;
  const text = { color: colors.foreground };
  const muted = { color: colors.foregroundMuted };
  const button = { padding: 10, borderRadius: 6, backgroundColor: colors.surface1 };
  const inputStyle = {
    ...text,
    borderWidth: 1,
    borderColor: colors.foregroundMuted,
    borderRadius: 6,
    padding: 10,
  };
  const rows = query.data?.rows ?? [];
  const chosen = rows.filter((row) => selected.includes(row.name) && canSync(row, direction));
  const conflicts = chosen.filter((row) => row.status === "different");
  const disabled = busy || query.isFetching || job.isPending || job.isError;

  async function save() {
    if (!draft || settings.status !== "ready") return;
    const parsed = SyncConfig.safeParse(draft);
    if (!parsed.success) {
      setError("Enter a GitHub repository as owner/repository.");
      return;
    }
    setError(null);
    if (await settings.save(parsed.data, draft.revision)) {
      setDraft(null);
      setSelected([]);
      setConfirm(false);
      setMessage(null);
    }
  }

  async function apply() {
    if (running.current || !query.data || !chosen.length || disabled) return;
    if (conflicts.length && !confirm) {
      setConfirm(true);
      return;
    }
    running.current = true;
    setStarting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await sync({
        agentId,
        token: query.data.token,
        names: chosen.map((row) => row.name),
        direction,
        overwrite: confirm,
      });
      queries.setQueryData(["skills-sync-job", agentId], {
        jobId: result.jobId,
        direction,
        state: "running",
        result: null,
      });
      await job.refetch();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSelected([]);
      setConfirm(false);
      running.current = false;
      setStarting(false);
    }
  }

  if (settings.status === "loading") return <ActivityIndicator color={colors.foregroundMuted} />;
  if (settings.status !== "ready")
    return <Text style={{ color: colors.statusDanger }}>{settings.error}</Text>;
  const editing =
    draft ??
    (!configured
      ? {
          repository: settings.values.repository,
          branch: settings.values.branch,
          revision: settings.revision,
        }
      : null);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface0 }}
      contentContainerStyle={{ padding: compact ? 12 : 20, gap: 12 }}
    >
      <Text style={{ ...text, fontSize: 18 }}>GitHub skill sync</Text>
      <Text style={muted}>
        Sync selected skill folders, including scripts and resources, through a private repository.
      </Text>
      {busy ? (
        <Text style={muted}>Sync in progress. You can reopen this screen to check its result.</Text>
      ) : null}
      {job.isError ? (
        <Pressable accessibilityRole="button" onPress={() => void job.refetch()}>
          <Text style={{ color: colors.statusDanger }}>{job.error.message} — Retry status</Text>
        </Pressable>
      ) : null}
      {editing ? (
        <View style={{ gap: 10 }}>
          <Text style={muted}>
            On each daemon host, install GitHub CLI and run gh auth login. Choose a private
            repository initialized with a README.
          </Text>
          <TextInput
            accessibilityLabel="GitHub repository"
            value={editing.repository}
            placeholder="owner/repository"
            placeholderTextColor={colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
            onChangeText={(repository) => setDraft({ ...editing, repository })}
          />
          <TextInput
            accessibilityLabel="GitHub branch"
            value={editing.branch}
            placeholder="Default branch"
            placeholderTextColor={colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
            onChangeText={(branch) => setDraft({ ...editing, branch })}
          />
          <Pressable
            accessibilityRole="button"
            style={button}
            disabled={!draft || settings.saving}
            onPress={() => void save()}
          >
            <Text style={text}>Save and compare</Text>
          </Pressable>
          {configured ? (
            <Pressable accessibilityRole="button" onPress={() => setDraft(null)}>
              <Text style={{ color: colors.accent }}>Cancel</Text>
            </Pressable>
          ) : null}
          {settings.saveError ? (
            <Text style={{ color: colors.statusDanger }}>{settings.saveError}</Text>
          ) : null}
        </View>
      ) : (
        <>
          <Text style={muted}>
            {config?.repository} · {query.data?.branch || config?.branch || "default branch"}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              style={button}
              disabled={disabled}
              onPress={() => {
                setConfirm(false);
                void query.refetch();
              }}
            >
              <Text style={text}>Check for updates</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={button}
              disabled={disabled}
              onPress={() => setDraft({ ...settings.values, revision: settings.revision })}
            >
              <Text style={text}>Repository settings</Text>
            </Pressable>
          </View>
          {query.isFetching || busy ? <ActivityIndicator color={colors.foregroundMuted} /> : null}
          {query.error ? (
            <Text style={{ color: colors.statusDanger }}>{query.error.message}</Text>
          ) : null}
          {query.data && !query.isError ? (
            <>
              <Text style={muted}>
                {rows.filter((row) => row.status === "remote-only").length} available to download ·{" "}
                {rows.filter((row) => row.status === "different").length} different ·{" "}
                {rows.filter((row) => row.status === "equal").length} up to date
              </Text>
              <Text style={muted}>
                New downloads go to {query.data.destination}. Existing skills update at the path
                shown below.
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {(["upload", "download"] as const).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: direction === value }}
                    style={button}
                    disabled={disabled}
                    onPress={() => {
                      setDirection(value);
                      setSelected([]);
                      setConfirm(false);
                    }}
                  >
                    <Text
                      style={{ color: direction === value ? colors.accent : colors.foreground }}
                    >
                      {value === "upload" ? "Upload to GitHub" : "Download to this machine"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={() => {
                    setSelected(
                      rows
                        .filter((row) => canSync(row, direction))
                        .slice(0, 50)
                        .map((row) => row.name),
                    );
                    setConfirm(false);
                  }}
                >
                  <Text style={{ color: colors.accent }}>Select up to 50</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={() => {
                    setSelected([]);
                    setConfirm(false);
                  }}
                >
                  <Text style={{ color: colors.accent }}>Clear</Text>
                </Pressable>
              </View>
              {rows.map((row) => (
                <View key={row.name} style={{ gap: 4, paddingVertical: 6 }}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${row.name}: ${statusLabels[row.status]}`}
                    accessibilityState={{
                      checked: selected.includes(row.name),
                      disabled: disabled || !canSync(row, direction),
                    }}
                    disabled={disabled || !canSync(row, direction)}
                    onPress={() => {
                      if (!selected.includes(row.name) && selected.length >= 50) {
                        setError("Select at most 50 skills per sync.");
                        return;
                      }
                      setSelected((current) =>
                        current.includes(row.name)
                          ? current.filter((name) => name !== row.name)
                          : [...current, row.name],
                      );
                      setConfirm(false);
                    }}
                  >
                    <Text style={text}>
                      {selected.includes(row.name) ? "☑" : "☐"} {row.name}
                    </Text>
                    <Text style={row.status === "blocked" ? { color: colors.statusDanger } : muted}>
                      {row.error ?? statusLabels[row.status]}
                    </Text>
                  </Pressable>
                  <Text style={muted} selectable>
                    {row.localPath}
                  </Text>
                  {row.changes.length ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setExpanded(expanded === row.name ? null : row.name)}
                    >
                      <Text style={{ color: colors.accent }}>
                        {expanded === row.name ? "Hide" : "Show"} {row.changes.length} changed files
                      </Text>
                    </Pressable>
                  ) : null}
                  {expanded === row.name
                    ? row.changes.map((file) => (
                        <Text key={file.path} style={muted}>
                          {file.kind}: {file.path}
                        </Text>
                      ))
                    : null}
                </View>
              ))}
              {rows.length === 0 ? (
                <Text style={muted}>No local or repository skills found.</Text>
              ) : null}
              {confirm ? (
                <Text style={{ color: colors.statusDanger }}>
                  Replace the {direction === "upload" ? "GitHub" : "local"} version of{" "}
                  {conflicts.map((row) => row.name).join(", ")}? Files missing from the chosen
                  version will be removed from those skill folders.
                  {direction === "download"
                    ? " Local backups will be kept."
                    : " The previous version remains in Git history."}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                style={{ ...button, opacity: disabled || !chosen.length ? 0.5 : 1 }}
                disabled={disabled || !chosen.length}
                onPress={() => void apply()}
              >
                <Text style={text}>
                  {confirm
                    ? "Confirm replacement"
                    : direction === "upload"
                      ? "Upload selected"
                      : "Download selected"}{" "}
                  ({chosen.length})
                </Text>
              </Pressable>
              {confirm ? (
                <Pressable accessibilityRole="button" onPress={() => setConfirm(false)}>
                  <Text style={{ color: colors.accent }}>Cancel replacement</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
        </>
      )}
      {message ? (
        <Text style={text} selectable>
          {message}
        </Text>
      ) : null}
      {error ? <Text style={{ color: colors.statusDanger }}>{error}</Text> : null}
    </ScrollView>
  );
}
