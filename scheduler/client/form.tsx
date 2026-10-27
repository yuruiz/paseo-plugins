import { useState } from "react";
import { View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { jobInputSchema, type Calendar, type JobInput, type Rule } from "../shared/model";
import { previewRpc } from "../shared/rpc";
import { ProviderFields } from "./provider-fields";
import {
  hours,
  minutes,
  offsetHours,
  runTimeOptions,
  ordinalOptions,
  weekdays,
  toggleWeekday,
  timeZones,
  preserveSelection,
  splitOffset,
  combineOffset,
} from "./schedule-options";
import { Action, Card, Copy, Disclosure, Field, Grid, Notice, Row, Select, Title } from "./ui";

interface Draft {
  name: string;
  prompt: string;
  provider: string;
  cwd: string;
  mode: string;
  thinking: string;
  workspaceId: string;
  appendDateToTitle: boolean;
  autoArchive: boolean;
  calendarId: string;
  timezone: string;
  recurrence: Rule["recurrence"]["kind"];
  ordinal: string;
  weekday: string;
  weekdays: string;
  adjustment: Rule["adjustment"];
  withinMonth: boolean;
  timeKind: "fixed" | "open" | "close";
  time: string;
  offset: string;
  missed: JobInput["missed"];
  enabled: boolean;
}

function draftFrom(input: JobInput | null): Draft {
  if (!input)
    return {
      name: "",
      prompt: "",
      provider: "codex",
      cwd: "",
      mode: "",
      thinking: "",
      workspaceId: "",
      appendDateToTitle: false,
      autoArchive: true,
      calendarId: "civil",
      timezone: "Asia/Shanghai",
      recurrence: "monthly-date",
      ordinal: "-1",
      weekday: "5",
      weekdays: "1,2,3,4,5",
      adjustment: "skip",
      withinMonth: true,
      timeKind: "fixed",
      time: "09:00",
      offset: "0",
      missed: "skip",
      enabled: false,
    };
  const recurrence = input.rule.recurrence;
  let ordinal = "-1";
  if (recurrence.kind === "monthly-date") ordinal = String(recurrence.day);
  if (recurrence.kind === "monthly-business-day" || recurrence.kind === "monthly-weekday")
    ordinal = String(recurrence.ordinal);
  const time = input.rule.time;
  return {
    name: input.name,
    prompt: input.prompt,
    provider: input.provider,
    cwd: input.cwd,
    mode: input.mode,
    thinking: input.thinking,
    workspaceId: input.workspaceId,
    appendDateToTitle: input.appendDateToTitle,
    autoArchive: input.autoArchive,
    calendarId: input.rule.calendarId,
    timezone: input.rule.timezone,
    recurrence: recurrence.kind,
    ordinal,
    weekday: recurrence.kind === "monthly-weekday" ? String(recurrence.weekday) : "5",
    weekdays: recurrence.kind === "weekly" ? recurrence.weekdays.join(",") : "1,2,3,4,5",
    adjustment: input.rule.adjustment,
    withinMonth: input.rule.withinMonth,
    timeKind: time.kind === "fixed" ? "fixed" : time.anchor,
    time: time.kind === "fixed" ? time.at : "09:00",
    offset: time.kind === "session" ? String(time.offsetMinutes) : "0",
    missed: input.missed,
    enabled: input.enabled,
  };
}

function ruleFrom(draft: Draft): Rule {
  let recurrence: Rule["recurrence"];
  switch (draft.recurrence) {
    case "daily":
      recurrence = { kind: "daily" };
      break;
    case "weekly":
      recurrence = { kind: "weekly", weekdays: draft.weekdays.split(",").map(Number) };
      break;
    case "monthly-date":
      recurrence = { kind: "monthly-date", day: Number(draft.ordinal) };
      break;
    case "monthly-business-day":
      recurrence = { kind: "monthly-business-day", ordinal: Number(draft.ordinal) };
      break;
    case "monthly-weekday":
      recurrence = {
        kind: "monthly-weekday",
        ordinal: Number(draft.ordinal),
        weekday: Number(draft.weekday),
      };
      break;
  }
  const time: Rule["time"] =
    draft.timeKind === "fixed"
      ? { kind: "fixed", at: draft.time }
      : { kind: "session", anchor: draft.timeKind, offsetMinutes: Number(draft.offset) };
  return {
    calendarId: draft.calendarId,
    timezone: draft.timezone,
    recurrence,
    adjustment: draft.adjustment,
    withinMonth: draft.withinMonth,
    time,
  };
}

export function JobForm({
  initial,
  calendars,
  saving,
  error,
  onSave,
  onCancel,
  onRefreshRevision,
}: {
  initial: JobInput | null;
  calendars: Calendar[];
  saving: boolean;
  error: string | null;
  onSave: (job: JobInput) => void;
  onCancel: () => void;
  onRefreshRevision: () => void;
}) {
  const [draft, setDraft] = useState(() => draftFrom(initial));
  const [catalogCwd, setCatalogCwd] = useState(() => initial?.cwd ?? "");
  const [customTimeZone, setCustomTimeZone] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const callPreview = useRpc(previewRpc);
  const preview = useMutation({
    mutationFn: () => callPreview({ rule: ruleFrom(draft), count: 5 }),
  });
  function update(patch: Partial<Draft>) {
    setDraft((old) => ({ ...old, ...patch }));
    setValidation(null);
    preview.reset();
  }
  function save() {
    const result = jobInputSchema.safeParse({
      name: draft.name,
      prompt: draft.prompt,
      provider: draft.provider,
      cwd: draft.cwd,
      mode: draft.mode,
      thinking: draft.thinking,
      workspaceId: draft.workspaceId,
      appendDateToTitle: draft.appendDateToTitle,
      autoArchive: draft.autoArchive,
      rule: ruleFrom(draft),
      missed: draft.missed,
      enabled: draft.enabled,
    });
    if (!result.success) {
      setValidation(
        result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"),
      );
      return;
    }
    onSave(result.data);
  }
  const calendar = calendars.find((item) => item.id === draft.calendarId);
  const [hour, minute] = draft.time.split(":");
  const offset = splitOffset(draft.offset);
  const ordinalLimit = draft.recurrence === "monthly-weekday" ? 5 : 31;
  const monthly = draft.recurrence.startsWith("monthly");
  const adjustable = draft.recurrence === "monthly-date" || draft.recurrence === "monthly-weekday";
  return (
    <Card>
      <Row>
        <View style={{ flexGrow: 1 }}>
          <Title>{initial ? "Edit schedule" : "New schedule"}</Title>
        </View>
        <Action
          label={draft.enabled ? "Enabled" : "Paused"}
          selected={draft.enabled}
          onPress={() => update({ enabled: !draft.enabled })}
        />
      </Row>
      <Grid>
        <Field label="Schedule name" value={draft.name} onChange={(name) => update({ name })} />
        <Select
          label="Calendar"
          value={draft.calendarId}
          options={calendars.map((calendar) => ({ value: calendar.id, label: calendar.name }))}
          onChange={(calendarId) => {
            const calendar = calendars.find((item) => item.id === calendarId)!;
            update({ calendarId, timezone: calendar.timezone, timeKind: "fixed" });
            setCustomTimeZone(false);
          }}
        />
      </Grid>
      <Grid>
        <Select
          label="Recurrence"
          value={draft.recurrence}
          options={[
            { value: "daily", label: "Daily / every business day" },
            { value: "weekly", label: "Weekly" },
            { value: "monthly-date", label: "Monthly date / month end" },
            { value: "monthly-business-day", label: "Nth business day of the month" },
            { value: "monthly-weekday", label: "Nth weekday of the month" },
          ]}
          onChange={(recurrence) =>
            update({
              recurrence,
              adjustment: "skip",
              ordinal:
                recurrence === "monthly-weekday" && Math.abs(Number(draft.ordinal)) > 5
                  ? "-1"
                  : draft.ordinal,
            })
          }
        />
        <Select
          label="Run time"
          value={draft.timeKind}
          options={runTimeOptions.filter((option) => calendar?.session || option.value === "fixed")}
          onChange={(timeKind) => update({ timeKind })}
        />
      </Grid>
      <Grid>
        {monthly ? (
          <Select
            label="Day / position"
            value={draft.ordinal}
            options={ordinalOptions(ordinalLimit)}
            onChange={(ordinal) => update({ ordinal })}
            hint="Choose Last for month end or the final matching day. Dates absent from a month are skipped."
          />
        ) : null}
        {draft.recurrence === "monthly-weekday" ? (
          <Select
            label="Weekday"
            value={draft.weekday}
            options={weekdays}
            onChange={(weekday) => update({ weekday })}
          />
        ) : null}
      </Grid>
      {draft.recurrence === "weekly" ? (
        <View style={{ gap: 4 }}>
          <Copy muted>Weekdays</Copy>
          <Row>
            {weekdays.map((day) => (
              <Action
                key={day.value}
                label={day.label.slice(0, 3)}
                selected={draft.weekdays.split(",").includes(day.value)}
                onPress={() => update({ weekdays: toggleWeekday(draft.weekdays, day.value) })}
              />
            ))}
          </Row>
        </View>
      ) : null}

      {adjustable ? (
        <Grid>
          <Select
            label="On a non-business day"
            value={draft.adjustment}
            options={[
              { value: "skip", label: "Skip" },
              { value: "previous", label: "Move earlier" },
              { value: "next", label: "Move later" },
            ]}
            onChange={(adjustment) => update({ adjustment })}
          />
          <Select
            label="Month boundary"
            value={draft.withinMonth ? "same" : "cross"}
            options={[
              { value: "same", label: "Stay in month" },
              { value: "cross", label: "Allow crossing" },
            ]}
            onChange={(value) => update({ withinMonth: value === "same" })}
          />
        </Grid>
      ) : null}

      <Grid>
        {draft.timeKind === "fixed" ? (
          <View style={{ gap: 4 }}>
            <Copy muted>Local time (24-hour)</Copy>
            <Grid>
              <Select
                label="Hour"
                value={hour}
                options={hours}
                onChange={(value) => update({ time: `${value}:${minute}` })}
              />
              <Select
                label="Minute"
                value={minute}
                options={minutes}
                onChange={(value) => update({ time: `${hour}:${value}` })}
              />
            </Grid>
          </View>
        ) : (
          <View style={{ gap: 4 }}>
            <Select
              label="Offset direction"
              value={offset.direction}
              options={[
                { value: "before", label: "Before" },
                { value: "after", label: "After" },
              ]}
              onChange={(direction) => update({ offset: combineOffset({ ...offset, direction }) })}
            />
            <Grid>
              <Select
                label="Offset hours"
                value={offset.hours}
                options={offsetHours}
                onChange={(hours) => update({ offset: combineOffset({ ...offset, hours }) })}
              />
              <Select
                label="Offset minutes"
                value={offset.minutes}
                options={offset.hours === "12" ? minutes.slice(0, 1) : minutes}
                onChange={(minutes) => update({ offset: combineOffset({ ...offset, minutes }) })}
              />
            </Grid>
            <Copy muted>
              HKEX close uses the latest auction end: 16:10 on full days, 12:10 on half days.
            </Copy>
          </View>
        )}
        <View style={{ gap: 4 }}>
          {customTimeZone && draft.calendarId === "civil" ? (
            <Field
              label="Custom time zone"
              value={draft.timezone}
              onChange={(timezone) => update({ timezone })}
              hint="Enter an IANA time zone such as Pacific/Auckland."
            />
          ) : (
            <Select
              label="Time zone"
              value={draft.timezone}
              options={preserveSelection(timeZones, draft.timezone)}
              disabled={draft.calendarId !== "civil"}
              onChange={(timezone) => update({ timezone })}
              hint={
                draft.calendarId === "civil"
                  ? "Run times follow this time zone, including daylight saving changes."
                  : `Uses the calendar's time zone: ${calendar?.timezone ?? draft.timezone}.`
              }
            />
          )}
          {draft.calendarId === "civil" ? (
            <Action
              ghost
              label={customTimeZone ? "Choose time zone from list" : "Use another time zone"}
              onPress={() => setCustomTimeZone((value) => !value)}
            />
          ) : null}
        </View>
      </Grid>
      <Action
        label={preview.isPending ? "Calculating…" : "Preview next 5 runs"}
        disabled={preview.isPending}
        onPress={() => preview.mutate()}
      />
      <Notice error message={preview.error?.message} />
      {preview.data?.occurrences.map((occurrence) => (
        <View key={occurrence.scheduledAt} style={{ gap: 4 }}>
          <Copy>{occurrence.localTime}</Copy>
          <Copy muted>
            {occurrence.reason}
            {occurrence.halfDay ? " · Half day" : ""}
          </Copy>
        </View>
      ))}
      <Notice message={preview.data?.notice} />
      <Field
        label="Working directory on the host"
        value={draft.cwd}
        onChange={(cwd) => update({ cwd })}
        onBlur={() => setCatalogCwd(draft.cwd.trim())}
      />
      <ProviderFields
        provider={draft.provider}
        mode={draft.mode}
        thinking={draft.thinking}
        cwd={catalogCwd}
        onChange={update}
      />
      <Field
        label="Task prompt"
        multiline
        value={draft.prompt}
        onChange={(prompt) => update({ prompt })}
      />
      <Select
        label="After run"
        value={draft.autoArchive ? "archive" : "keep"}
        options={[
          { value: "archive", label: "Archive conversation" },
          { value: "keep", label: "Keep conversation" },
        ]}
        onChange={(value) => update({ autoArchive: value === "archive" })}
      />
      <Copy muted>
        Applies to future runs after they finish or fail. Archived conversations remain available in
        Run history. Shared workspaces stay available.
      </Copy>
      <Disclosure title="More options">
        <Field
          label="Existing workspace ID (optional)"
          value={draft.workspaceId}
          onChange={(workspaceId) => update({ workspaceId })}
          hint="Reuse this workspace for each run. Leave blank to create a fresh local workspace."
        />
        <Grid>
          <Select
            label="Agent title"
            value={draft.appendDateToTitle ? "date" : "name"}
            options={[
              { value: "date", label: "Name + local date" },
              { value: "name", label: "Name only" },
            ]}
            onChange={(value) => update({ appendDateToTitle: value === "date" })}
          />
          <Select
            label="Missed runs"
            value={draft.missed}
            options={[
              { value: "skip", label: "Skip" },
              { value: "latest", label: "Run the latest missed occurrence" },
            ]}
            onChange={(missed) => update({ missed })}
          />
        </Grid>
        <Copy muted>
          A schedule waits while a previous run is active or unconfirmed. Editing or resuming a
          schedule resets its starting point to the save time.
        </Copy>
      </Disclosure>
      <Notice error message={validation ?? error} />
      {error ? <Action label="Refresh version, keep draft" onPress={onRefreshRevision} /> : null}
      <Row>
        <Action
          primary
          label={saving ? "Saving…" : "Save schedule"}
          disabled={saving}
          onPress={save}
        />
        <Action label="Cancel" disabled={saving} onPress={onCancel} />
      </Row>
    </Card>
  );
}
