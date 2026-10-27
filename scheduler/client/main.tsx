import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { calendarSchema, type Calendar, type Job, type JobInput, type Run } from "../shared/model";
import {
  importRpc,
  previewRpc,
  removeRpc,
  resolveRpc,
  runRpc,
  saveRpc,
  statusRpc,
} from "../shared/rpc";
import { JobForm } from "./form";
import { Setup } from "./setup";
import { Action, Card, Choices, Copy, Field, Notice, Row, Title, UiProvider } from "./ui";

interface Editor {
  id: string | null;
  initial: JobInput | null;
  revision: number;
}
type Mutation =
  | { kind: "save"; id: string | null; job: JobInput; revision: number }
  | { kind: "remove"; id: string; revision: number }
  | { kind: "run"; id: string }
  | { kind: "resolve"; id: string; revision: number }
  | { kind: "import"; calendar: Calendar; revision: number };

export function inputFromJob(job: Job): JobInput {
  return {
    name: job.name,
    prompt: job.prompt,
    provider: job.provider,
    cwd: job.cwd,
    mode: job.mode,
    thinking: job.thinking,
    workspaceId: job.workspaceId,
    appendDateToTitle: job.appendDateToTitle,
    autoArchive: job.autoArchive,
    rule: job.rule,
    missed: job.missed,
    enabled: job.enabled,
  };
}

export function SchedulerSurface(props: PluginSurfaceProps) {
  const [width, setWidth] = useState<number | null>(null);
  const compact = props.layout.compact || (width !== null && width < 640);
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, minWidth: 0 }}
      behavior={props.layout.platform === "ios" ? "padding" : undefined}
      onLayout={(event) => {
        const nextWidth = event.nativeEvent.layout.width;
        if (nextWidth > 0) setWidth(nextWidth);
      }}
    >
      <UiProvider theme={props.theme} compact={compact}>
        <Main {...props} layout={{ ...props.layout, compact }} />
      </UiProvider>
    </KeyboardAvoidingView>
  );
}

function Main({ theme, layout, navigation }: PluginSurfaceProps) {
  const [tab, setTab] = useState<"jobs" | "calendars" | "runs" | "settings">("jobs");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const status = useRpc(statusRpc);
  const save = useRpc(saveRpc);
  const remove = useRpc(removeRpc);
  const run = useRpc(runRpc);
  const resolve = useRpc(resolveRpc);
  const importCalendar = useRpc(importRpc);
  const state = useQuery({
    queryKey: ["scheduler", "status"],
    queryFn: () => status({}),
    refetchInterval: 15000,
  });
  const mutation = useMutation({
    mutationFn: async (action: Mutation) => {
      switch (action.kind) {
        case "save":
          return save({ id: action.id, job: action.job, revision: action.revision });
        case "remove":
          return remove({ id: action.id, revision: action.revision });
        case "run":
          return run({ id: action.id });
        case "resolve":
          return resolve({ id: action.id, revision: action.revision });
        case "import":
          return importCalendar({ calendar: action.calendar, revision: action.revision });
      }
    },
    onSuccess: async (_, action) => {
      if (action.kind === "save") setEditor(null);
      setNotice(
        action.kind === "run"
          ? "Run requested. Check Run history for the submission result."
          : "Saved.",
      );
      await queryClient.invalidateQueries({ queryKey: ["scheduler"] });
    },
    onError: () => {
      void state.refetch();
    },
  });
  function mutate(action: Mutation) {
    setNotice(null);
    mutation.mutate(action);
  }
  const stored = state.data?.state;
  const calendars = state.data?.calendars ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={{
        padding: layout.compact ? 12 : 16,
        paddingBottom: 32,
        gap: 12,
        maxWidth: 1100,
        width: "100%",
        alignSelf: "center",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Choices
          value={tab}
          options={[
            { value: "jobs", label: "Schedules" },
            { value: "calendars", label: "Calendars" },
            { value: "runs", label: "Run history" },
            { value: "settings", label: "Settings" },
          ]}
          onChange={(next) => {
            setTab(next);
            setNotice(null);
          }}
        />
        {!editor && tab === "jobs" ? (
          <Action
            primary
            label="New schedule"
            disabled={state.isLoading}
            onPress={() => {
              mutation.reset();
              setEditor({ id: null, initial: null, revision: stored?.revision ?? 0 });
            }}
          />
        ) : null}
      </View>
      <Notice error message={state.error?.message ?? state.data?.error} />
      <Notice error message={mutation.error?.message} />
      <Notice message={notice} />
      {state.isLoading ? <Copy>Loading…</Copy> : null}
      {state.isError ? (
        <Action
          label="Reload"
          onPress={() => {
            void state.refetch();
          }}
        />
      ) : null}
      {state.data && !stored ? (
        <Card>
          <Copy>
            Set up a scheduler data directory to save schedules. You can browse calendars and
            preview rules first.
          </Copy>
          <Action label="Open settings" onPress={() => setTab("settings")} />
        </Card>
      ) : null}
      {stored && !state.data?.executing ? (
        <Notice message="Background execution is paused. Schedules and history are retained; enabling it applies each schedule’s missed-run policy." />
      ) : null}
      {tab === "settings" ? <Setup /> : null}
      {tab === "jobs" ? (
        <View style={{ gap: 8 }}>
          {editor ? (
            <JobForm
              key={editor.id ?? "new"}
              initial={editor.initial}
              calendars={calendars}
              saving={mutation.isPending}
              error={mutation.error?.message ?? null}
              onSave={(job) =>
                mutate({ kind: "save", id: editor.id, job, revision: editor.revision })
              }
              onCancel={() => setEditor(null)}
              onRefreshRevision={() => {
                void state.refetch().then((result) => {
                  if (result.data?.state) {
                    const revision = result.data.state.revision;
                    setEditor((current) => (current ? { ...current, revision } : null));
                    mutation.reset();
                  }
                });
              }}
            />
          ) : null}
          {!editor && stored?.jobs.length === 0 ? (
            <Copy muted>
              No schedules yet. Create a paused schedule, preview its run times, then enable it.
            </Copy>
          ) : null}
          {!editor &&
            stored?.jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                calendarVersion={
                  calendars.find((calendar) => calendar.id === job.rule.calendarId)?.version ?? ""
                }
                busy={mutation.isPending}
                executing={state.data?.executing ?? false}
                onEdit={() => {
                  mutation.reset();
                  setEditor({ id: job.id, initial: inputFromJob(job), revision: stored.revision });
                }}
                onToggle={() =>
                  mutate({
                    kind: "save",
                    id: job.id,
                    job: { ...inputFromJob(job), enabled: !job.enabled },
                    revision: stored.revision,
                  })
                }
                onRun={() => mutate({ kind: "run", id: job.id })}
                onRemove={() => mutate({ kind: "remove", id: job.id, revision: stored.revision })}
              />
            ))}
        </View>
      ) : null}
      {tab === "calendars" ? (
        <Calendars
          calendars={calendars}
          busy={mutation.isPending}
          configured={Boolean(stored)}
          onImport={(calendar) => {
            if (stored) mutate({ kind: "import", calendar, revision: stored.revision });
          }}
        />
      ) : null}
      {tab === "runs" ? (
        <Runs
          runs={stored?.runs ?? []}
          busy={mutation.isPending}
          navigation={navigation}
          onResolve={(id) => {
            if (stored) mutate({ kind: "resolve", id, revision: stored.revision });
          }}
        />
      ) : null}
    </ScrollView>
  );
}

function JobCard({
  job,
  calendarVersion,
  busy,
  executing,
  onEdit,
  onToggle,
  onRun,
  onRemove,
}: {
  job: Job;
  calendarVersion: string;
  busy: boolean;
  executing: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onRun: () => void;
  onRemove: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [details, setDetails] = useState(false);
  const getPreview = useRpc(previewRpc);
  const next = useQuery({
    queryKey: ["scheduler", "next", job.id, job.revision, calendarVersion],
    queryFn: () => getPreview({ rule: job.rule, count: 1 }),
    refetchInterval: 60000,
  });
  const occurrence = next.data?.occurrences[0];
  const nextTime = occurrence
    ? new Date(occurrence.scheduledAt).toLocaleString("en-GB", {
        timeZone: job.rule.timezone,
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    : "Not available";
  return (
    <Card>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 320, gap: 3 }}>
          <Row>
            <Title>{job.name}</Title>
            <Copy muted>
              {job.enabled ? "Enabled" : "Paused"} · {job.provider}
            </Copy>
          </Row>
          <Copy muted>
            Next: {nextTime} · {job.rule.timezone}
          </Copy>
          <Copy muted>
            {job.autoArchive ? "Auto-archive after finish" : "Keep conversation after finish"}
          </Copy>
        </View>
        <Row>
          <Action label="Edit" disabled={busy} onPress={onEdit} />
          <Action
            ghost
            label={job.enabled ? "Pause" : "Enable"}
            disabled={busy}
            onPress={onToggle}
          />
          <Action ghost label="Run now" disabled={busy || !executing} onPress={onRun} />
          <Action
            ghost
            label={details ? "Less" : "Details"}
            onPress={() => setDetails((value) => !value)}
          />
          <Action ghost label="Delete" disabled={busy} onPress={() => setConfirmDelete(true)} />
        </Row>
      </View>
      {details ? (
        <View style={{ gap: 3 }}>
          <Copy muted>{job.cwd}</Copy>
          <Copy muted>
            Mode: {job.mode || "Not set — edit and save to pin the provider default"} · Thinking:{" "}
            {job.thinking || "Default"}
          </Copy>
          <Copy muted>Workspace: {job.workspaceId || "New local workspace"}</Copy>
        </View>
      ) : null}
      <Notice error message={job.error ?? next.error?.message} />
      <Notice message={next.data?.notice} />
      {confirmDelete ? (
        <Row>
          <Copy>Delete this schedule? Run history will be retained.</Copy>
          <Action label="Confirm deletion" disabled={busy} onPress={onRemove} />
          <Action label="Cancel deletion" onPress={() => setConfirmDelete(false)} />
        </Row>
      ) : null}
    </Card>
  );
}

function Calendars({
  calendars,
  configured,
  busy,
  onImport,
}: {
  calendars: Calendar[];
  configured: boolean;
  busy: boolean;
  onImport: (calendar: Calendar) => void;
}) {
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  function submit() {
    try {
      const calendar = calendarSchema.parse(JSON.parse(json));
      setError(null);
      onImport(calendar);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Card>
        <Copy>
          Built-in calendars cover 2026. Scheduling stops beyond the coverage range until the
          calendar is updated. Half days are trading days. US markets use New York time; HKEX uses
          Hong Kong time.
        </Copy>
        <Copy muted>
          Calendars are local snapshots of official announcements. Unscheduled changes are not
          fetched automatically. Importing the same ID replaces the entire calendar: preserve the
          required coverage and increase its version. Use a new ID for a custom business calendar.
        </Copy>
      </Card>
      {calendars.map((calendar) => (
        <Card key={calendar.id}>
          <Title>{calendar.name}</Title>
          <Copy>
            {calendar.id} · v{calendar.version} · {calendar.timezone}
          </Copy>
          <Copy muted>
            Coverage: {calendar.validFrom} — {calendar.validThrough}
          </Copy>
          {calendar.sources.map((source) => (
            <Copy key={source} muted>
              {source}
            </Copy>
          ))}
          <Action
            label={`Edit / export ${calendar.id}`}
            onPress={() => {
              setJson(JSON.stringify(calendar, null, 2));
              setError(null);
            }}
          />
        </Card>
      ))}
      <Card>
        <Title>Import / customize a business calendar</Title>
        <Field
          label="Calendar JSON"
          multiline
          value={json}
          onChange={setJson}
          hint="weekdays uses 1 = Monday through 7 = Sunday. overrides defines closed days, extra business days, and half days. Dates, time zones, and coverage are validated on import."
        />
        <Notice error message={error} />
        <Action
          primary
          label={busy ? "Importing…" : "Validate and import calendar"}
          disabled={busy || !configured}
          onPress={submit}
        />
      </Card>
    </View>
  );
}

const runLabels: Record<Run["status"], string> = {
  dispatching: "Submitting",
  submitted: "Agent running",
  finished: "Agent finished",
  failed: "Agent error",
  uncertain: "Awaiting confirmation",
  skipped: "Skipped",
};
function Runs({
  runs,
  busy,
  onResolve,
  navigation,
}: {
  runs: Run[];
  busy: boolean;
  onResolve: (id: string) => void;
  navigation: PluginSurfaceProps["navigation"];
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  return (
    <View style={{ gap: 8 }}>
      <Copy muted>
        “Agent finished” means the agent returned to an idle state. Check its conversation for the
        task outcome. The most recent 100 runs are shown here.
      </Copy>
      {runs.length === 0 ? <Copy>No run history yet.</Copy> : null}
      {[...runs]
        .reverse()
        .slice(0, 100)
        .map((run) => (
          <Card key={run.id}>
            <Title>{run.jobName}</Title>
            <Copy>
              {runLabels[run.status]} · {run.scheduledAt}
            </Copy>
            <Copy muted>{run.message}</Copy>
            {run.autoArchive ? (
              <Copy muted>
                {run.archivedAt ? `Archived: ${run.archivedAt}` : "Auto-archive after finish"}
              </Copy>
            ) : null}
            <Notice error message={run.archiveError} />
            <Copy muted>
              Calendar version: {run.calendarVersion} · Occurrence ID: {run.id}
            </Copy>
            {run.agentId ? (
              <View style={{ gap: 8 }}>
                <Copy muted>Agent: {run.agentId}</Copy>
                {navigation ? (
                  <Action
                    label="Open conversation"
                    onPress={() => {
                      if (run.agentId) navigation.openAgent({ agentId: run.agentId });
                    }}
                  />
                ) : (
                  <Copy muted>Update the Paseo app to open conversations from history.</Copy>
                )}
              </View>
            ) : null}
            {run.status === "uncertain" ? (
              <Action
                label="Reviewed: unblock this run"
                disabled={busy}
                onPress={() => setConfirmId(run.id)}
              />
            ) : null}
            {confirmId === run.id ? (
              <View style={{ gap: 8 }}>
                <Copy>
                  Check the corresponding agent first. Unblocking does not cancel or retry a
                  submitted task.
                </Copy>
                <Row>
                  <Action
                    label="Confirm unblock"
                    disabled={busy}
                    onPress={() => {
                      onResolve(run.id);
                      setConfirmId(null);
                    }}
                  />
                  <Action label="Cancel" onPress={() => setConfirmId(null)} />
                </Row>
              </View>
            ) : null}
          </Card>
        ))}
    </View>
  );
}
