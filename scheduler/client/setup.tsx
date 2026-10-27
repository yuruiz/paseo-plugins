import { useState } from "react";
import { View } from "react-native";
import { useSettings } from "@getpaseo/plugin/client";
import { schedulerSettings, type Settings } from "../shared/settings";
import { Action, Card, Copy, Field, Notice, Title } from "./ui";

export function Setup() {
  const settings = useSettings(schedulerSettings);
  const [saved, setSaved] = useState(false);
  const [saveCount, setSaveCount] = useState(0);
  if (settings.status === "loading") return <Copy>Loading settings…</Copy>;
  if (settings.status !== "ready")
    return (
      <Card>
        <Notice error message={settings.error} />
        <Action
          label="Reload settings"
          onPress={() => {
            void settings.reload();
          }}
        />
      </Card>
    );
  return (
    <View style={{ gap: 12 }}>
      <SetupEditor
        key={saveCount}
        initial={settings.values}
        initialRevision={settings.revision}
        saving={settings.saving}
        error={settings.saveError}
        saved={saved}
        onSave={async (values, revision) => {
          setSaved(false);
          const success = await settings.save(values, revision);
          setSaved(success);
          if (success) setSaveCount((count) => count + 1);
        }}
      />
      {settings.saveError ? (
        <Action
          label="Discard settings draft and reload"
          disabled={settings.saving}
          onPress={() => {
            void settings.reload().then(() => {
              setSaveCount((count) => count + 1);
              setSaved(false);
            });
          }}
        />
      ) : null}
    </View>
  );
}

function SetupEditor({
  initial,
  initialRevision,
  saving,
  error,
  saved,
  onSave,
}: {
  initial: Settings;
  initialRevision: string;
  saving: boolean;
  error: string | null;
  saved: boolean;
  onSave: (values: Settings, revision: string) => Promise<void>;
}) {
  const [values, setValues] = useState(initial);
  const [revision] = useState(initialRevision);
  return (
    <Card>
      <Title>Background execution settings</Title>
      <Copy muted>
        Paths refer to this plugin’s host. Select its daemon home so tasks run on the intended
        instance.
      </Copy>
      <Field
        label="Daemon home (absolute path)"
        value={values.daemonHome}
        onChange={(daemonHome) => setValues((old) => ({ ...old, daemonHome }))}
        hint="For example, /Users/your-name/.paseo. Development instances may use a different directory."
      />
      <Field
        label="Scheduler data directory (absolute path)"
        value={values.stateDirectory}
        onChange={(stateDirectory) => setValues((old) => ({ ...old, stateDirectory }))}
        hint="For example, /Users/your-name/.paseo/scheduler-data. Each plugin installation needs its own directory."
      />
      <Field
        label="Paseo CLI path"
        value={values.cliPath}
        onChange={(cliPath) => setValues((old) => ({ ...old, cliPath }))}
        hint="Use paseo or its absolute path. An absolute path is recommended for desktop installations."
      />
      <Action
        label={values.enabled ? "Background execution: enabled" : "Background execution: paused"}
        onPress={() => setValues((old) => ({ ...old, enabled: !old.enabled }))}
      />
      <Copy muted>
        Pausing preserves schedules and history. Resuming applies each schedule’s missed-run policy.
        Agents already started continue running.
      </Copy>
      <Notice error message={error} />
      {saved ? (
        <Notice message="Settings saved. Connection or directory errors appear at the top of the page." />
      ) : null}
      <Action
        primary
        label={saving ? "Saving…" : "Save settings"}
        disabled={saving}
        onPress={() => {
          void onSave(values, revision);
        }}
      />
    </Card>
  );
}
