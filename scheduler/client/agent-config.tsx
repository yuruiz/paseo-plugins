import { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { usePaseo } from "@getpaseo/plugin/client";
import type { AgentConfig } from "../shared/agent-config";
import type { JobInput, State } from "../shared/model";
import { ProviderFields } from "./provider-fields";
import { preserveSelection } from "./schedule-options";
import { Action, Card, Copy, Notice, Row, Select, Title } from "./ui";

type Selection = Pick<
  JobInput,
  "agentConfigSource" | "profileId" | "provider" | "mode" | "thinking"
>;

export function AgentConfigurationFields({
  value,
  onChange,
  cwd,
  allowDefault = false,
  defaults,
}: {
  value: Selection;
  onChange: (patch: Partial<Selection>) => void;
  cwd: string;
  allowDefault?: boolean;
  defaults?: AgentConfig | null;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Select
        label="Agent configuration"
        value={value.agentConfigSource}
        options={[
          ...(allowDefault
            ? [{ value: "default" as const, label: "Use shared configuration" }]
            : []),
          { value: "profile", label: "Paseo agent profile" },
          { value: "custom", label: "Custom provider and model" },
        ]}
        onChange={(agentConfigSource) => onChange({ agentConfigSource })}
      />
      {value.agentConfigSource === "custom" ? (
        <ProviderFields
          provider={value.provider}
          mode={value.mode}
          thinking={value.thinking}
          cwd={cwd}
          onChange={onChange}
        />
      ) : null}
      {value.agentConfigSource === "profile" ? (
        <ProfilePicker value={value.profileId} onChange={(profileId) => onChange({ profileId })} />
      ) : null}
      {value.agentConfigSource === "default" ? (
        <Notice
          error={!defaults}
          message={
            defaults
              ? `Follows Settings → Shared agent configuration for future runs. ${defaults.source === "profile" ? `Paseo profile: ${defaults.profileId}` : `${defaults.provider} · Mode: ${defaults.mode || "Default"} · Thinking: ${defaults.thinking || "Default"}`}`
              : "Save a shared agent configuration in Settings first, or choose a profile or custom configuration for this schedule."
          }
        />
      ) : null}
    </View>
  );
}

function ProfilePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const paseo = usePaseo();
  const profiles = useQuery({
    queryKey: ["scheduler", "agent-profiles"],
    queryFn: async () => (await paseo.config.get()).config.agentProfiles ?? [],
    staleTime: 30000,
  });
  const selected = profiles.data?.find((profile) => profile.id === value);
  return (
    <View style={{ gap: 8 }}>
      <Select
        label="Paseo agent profile"
        value={value}
        options={preserveSelection(
          [
            { value: "", label: "Choose a profile…" },
            ...(profiles.data ?? []).map((profile) => ({ value: profile.id, label: profile.name })),
          ],
          value,
        )}
        onChange={onChange}
        disabled={profiles.isPending}
        hint="Managed in Paseo Settings → Agents → Agent profiles. Each run uses the latest saved profile, including feature settings."
      />
      {selected ? (
        <Copy muted>
          {selected.provider}
          {selected.model ? `/${selected.model}` : ""} · Mode: {selected.modeId || "Default"} ·
          Thinking: {selected.thinkingOptionId || "Default"}
          {selected.notes ? `\n${selected.notes}` : ""}
        </Copy>
      ) : null}
      {profiles.isSuccess && !profiles.data.length ? (
        <Notice message="No profiles on this host. Create one in Paseo Settings, then refresh." />
      ) : null}
      {profiles.isSuccess && value && !selected ? (
        <Notice
          error
          message="The selected profile is no longer available. Choose another profile before running this schedule."
        />
      ) : null}
      <Notice error message={profiles.error?.message} />
      <Action
        ghost
        label={profiles.isFetching ? "Refreshing profiles…" : "Refresh profiles"}
        disabled={profiles.isFetching}
        onPress={() => {
          void profiles.refetch();
        }}
      />
    </View>
  );
}

export function AgentDefaultsEditor({
  state,
  saving,
  onSave,
}: {
  state: State;
  saving: boolean;
  onSave: (config: AgentConfig, applyToAll: boolean, revision: number) => void;
}) {
  const [value, setValue] = useState<Selection>(() => ({
    agentConfigSource: state.agentDefaults?.source ?? "custom",
    profileId: state.agentDefaults?.source === "profile" ? state.agentDefaults.profileId : "",
    provider: state.agentDefaults?.source === "custom" ? state.agentDefaults.provider : "codex",
    mode: state.agentDefaults?.source === "custom" ? state.agentDefaults.mode : "",
    thinking: state.agentDefaults?.source === "custom" ? state.agentDefaults.thinking : "",
  }));
  const [revision, setRevision] = useState(state.revision);
  const [error, setError] = useState<string | null>(null);
  function save(applyToAll: boolean) {
    if (value.agentConfigSource === "profile" && !value.profileId) {
      setError("Choose a Paseo agent profile");
      return;
    }
    onSave(
      value.agentConfigSource === "profile"
        ? { source: "profile", profileId: value.profileId }
        : {
            source: "custom",
            provider: value.provider,
            mode: value.mode,
            thinking: value.thinking,
          },
      applyToAll,
      revision,
    );
  }
  const inherited = state.jobs.filter((job) => job.agentConfigSource === "default").length;
  return (
    <Card>
      <Title>Shared agent configuration</Title>
      <Copy muted>
        New schedules use this configuration by default. {inherited} of {state.jobs.length} existing
        schedules follow it. Changes apply to future runs; agents already started keep their
        settings.
      </Copy>
      <AgentConfigurationFields
        value={value}
        onChange={(patch) => {
          setValue((old) => ({ ...old, ...patch }));
          setError(null);
        }}
        cwd=""
      />
      <Notice error message={error} />
      <Row>
        <Action
          primary
          label={saving ? "Saving…" : "Save shared configuration"}
          disabled={saving}
          onPress={() => save(false)}
        />
        <Action
          label={`Save and apply to all ${state.jobs.length} schedules`}
          disabled={saving || state.jobs.length === 0}
          onPress={() => save(true)}
        />
      </Row>
      <Copy muted>
        Apply to all switches every schedule, including paused schedules, to follow this
        configuration. Prompts, times, workspaces, and pause states stay the same. You can still set
        individual overrides.
      </Copy>
      {revision !== state.revision ? (
        <Action
          ghost
          label="Use latest revision and keep draft"
          disabled={saving}
          onPress={() => setRevision(state.revision)}
        />
      ) : null}
    </Card>
  );
}
