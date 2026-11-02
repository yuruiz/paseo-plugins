import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  useRpc,
  type PluginHostProps,
  type PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  cancelRpc,
  configureRpc,
  scheduleRpc,
  type ResumeView,
  type Preferences,
} from "../shared/contracts";
import { statusKey, useResumeStatus } from "./status";

type PluginTheme = PluginHostProps["theme"];
const titles = {
  detected: "Quota exhausted",
  waiting: "Waiting for quota reset",
  sending: "Resuming conversation",
  resumed: "Continuation sent",
  canceled: "Recovery canceled",
  attention: "Needs attention",
};
export function formatTime(value: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return value;
  }
}
function Button({
  title,
  onPress,
  disabled,
  theme,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  theme: PluginTheme;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: theme.colors.surface2,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: theme.colors.foreground }}>{title}</Text>
    </Pressable>
  );
}
export function ResumeControls({
  agentId,
  theme,
  compact = false,
  settings = true,
  jobId,
}: {
  agentId: string;
  theme: PluginTheme;
  compact?: boolean;
  settings?: boolean;
  jobId?: string;
}) {
  const query = useResumeStatus(agentId);
  const cache = useQueryClient();
  const configure = useRpc(configureRpc);
  const schedule = useRpc(scheduleRpc);
  const cancel = useRpc(cancelRpc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [timezone, setTimezone] = useState("");
  const [buffer, setBuffer] = useState("60");
  const [attempts, setAttempts] = useState("3");
  const data = query.data;
  useEffect(() => {
    if (!data) return;
    setTimezone(data.preferences.timezone);
    setBuffer(String(data.preferences.bufferSeconds));
    setAttempts(String(data.preferences.maxAttempts));
  }, [data?.preferences.timezone, data?.preferences.bufferSeconds, data?.preferences.maxAttempts]);
  async function act(action: () => Promise<ResumeView>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const value = await action();
      cache.setQueryData(statusKey(agentId), value);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const text = { color: theme.colors.foreground, fontSize: 14 };
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };
  const input = {
    ...text,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  };
  if (!data)
    return (
      <Text style={text}>
        {query.isError ? `Unable to load: ${query.error.message}` : "Loading recovery status…"}
      </Text>
    );
  const job = jobId && data.job?.id !== jobId ? null : data.job;
  const canSchedule =
    job &&
    ["detected", "waiting", "canceled", "attention"].includes(job.status) &&
    !job.note.includes("unknown");
  function savePreferences(patch: Partial<Preferences> = {}) {
    return act(() =>
      configure({
        agentId,
        preferences: {
          ...data!.preferences,
          timezone: timezone.trim(),
          bufferSeconds: Number(buffer),
          maxAttempts: Number(attempts),
          ...patch,
        },
      }),
    );
  }
  return (
    <View
      style={{
        gap: 12,
        padding: compact ? 12 : 16,
        backgroundColor: theme.colors.surface0,
        borderRadius: 12,
        minWidth: 0,
      }}
    >
      <Text style={{ ...text, fontSize: 16, fontWeight: "600" }}>Auto Resume</Text>
      {settings && (
        <>
          <Button
            theme={theme}
            title={`Auto-resume: ${data.preferences.enabled ? "On" : "Off"}`}
            disabled={busy}
            onPress={() => void savePreferences({ enabled: !data.preferences.enabled })}
          />
          <Text style={muted}>
            Applies to this conversation only. Waits for Claude/Codex quota to reset, then
            continues. Turning it off cancels the pending recovery.
          </Text>
        </>
      )}
      {job ? (
        <>
          <Text style={{ ...text, fontWeight: "600" }}>{titles[job.status]}</Text>
          {job.resetAt && (
            <Text style={text}>
              Expected reset: {formatTime(job.resetAt, data.preferences.timezone)}
            </Text>
          )}
          {job.status === "waiting" && job.runAt && (
            <Text style={text}>
              Resume at: {formatTime(job.runAt, data.preferences.timezone)} (
              {data.preferences.timezone})
            </Text>
          )}
          <Text style={muted}>{job.note}</Text>
          <Text style={muted}>
            Attempts: {job.attempts} / {data.preferences.maxAttempts}
          </Text>
          {canSchedule && (
            <>
              {job.resetAt && Date.parse(job.resetAt) > Date.now() && job.status !== "waiting" && (
                <Button
                  theme={theme}
                  title="Resume after reset"
                  disabled={busy}
                  onPress={() => void act(() => schedule({ agentId, jobId: job.id }))}
                />
              )}
              <Text style={muted}>
                Custom reset time (include a timezone, e.g. 2026-12-01T18:00:00+00:00)
              </Text>
              <TextInput
                accessibilityLabel="Custom reset time"
                value={date}
                onChangeText={setDate}
                autoCapitalize="none"
                placeholder="YYYY-MM-DDTHH:mm:ss+00:00"
                placeholderTextColor={theme.colors.foregroundMuted}
                style={input}
              />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Button
                  theme={theme}
                  title={job.status === "waiting" ? "Update schedule" : "Resume at this time"}
                  disabled={busy || !date.trim()}
                  onPress={() =>
                    void act(() => schedule({ agentId, jobId: job.id, resetAt: date.trim() }))
                  }
                />
                <Button
                  theme={theme}
                  title="Try in one hour"
                  disabled={busy}
                  onPress={() =>
                    void act(() =>
                      schedule({
                        agentId,
                        jobId: job.id,
                        resetAt: new Date(Date.now() + 3600000).toISOString(),
                      }),
                    )
                  }
                />
              </View>
            </>
          )}
          {["waiting", "detected"].includes(job.status) && (
            <Button
              theme={theme}
              title="Cancel recovery"
              disabled={busy}
              onPress={() => void act(() => cancel({ agentId, jobId: job.id }))}
            />
          )}
          {settings && (
            <Text selectable style={muted}>
              {job.reason}
            </Text>
          )}
        </>
      ) : (
        <Text style={muted}>
          {jobId
            ? "This quota notice is outdated. Open Auto Resume in the composer for the latest status."
            : "No quota limit detected yet."}
        </Text>
      )}
      {settings && (
        <>
          <Text style={text}>Timezone when the notice does not specify one</Text>
          <TextInput
            accessibilityLabel="Reset timezone"
            value={timezone}
            onChangeText={setTimezone}
            autoCapitalize="none"
            style={input}
          />
          <Text style={text}>Buffer after reset, in seconds (15–600)</Text>
          <TextInput
            accessibilityLabel="Buffer after reset"
            value={buffer}
            onChangeText={setBuffer}
            keyboardType="number-pad"
            style={input}
          />
          <Text style={text}>Maximum consecutive attempts (1–10)</Text>
          <TextInput
            accessibilityLabel="Maximum recovery attempts"
            value={attempts}
            onChangeText={setAttempts}
            keyboardType="number-pad"
            style={input}
          />
          <Button
            theme={theme}
            title="Save settings"
            disabled={busy}
            onPress={() => void savePreferences()}
          />
          <Text style={muted}>
            Your computer and Paseo daemon must be running. Manual activity, archiving, or
            cancellation invalidates a pending recovery. Detects quota errors; does not poll your
            remaining balance.
          </Text>
        </>
      )}
      {(error || query.isError) && (
        <Text accessibilityRole="alert" style={text}>
          {error || query.error?.message}
        </Text>
      )}
    </View>
  );
}
export function QuotaCard({
  agentId,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<{ jobId: string }>) {
  return (
    <ResumeControls
      agentId={agentId}
      jobId={item.data.jobId}
      theme={theme}
      compact={layout.compact}
      settings={false}
    />
  );
}
export function ResumePopover({
  agentId,
  theme,
  compact,
}: {
  agentId: string;
  theme: PluginTheme;
  compact: boolean;
}) {
  return (
    <ScrollView
      style={{ maxHeight: 560, width: compact ? "100%" : 380 }}
      keyboardShouldPersistTaps="handled"
    >
      <ResumeControls agentId={agentId} theme={theme} compact={compact} />
    </ScrollView>
  );
}
