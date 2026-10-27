import { useEffect, useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { usePaseo } from "@getpaseo/plugin/client";
import type { JobInput } from "../shared/model";
import { Action, Copy, Field, Grid, Notice, Row, Select } from "./ui";
import {
  defaultModeId,
  modelOptions,
  modeOptions,
  preserveSelection,
  providerModel,
  providerOptions,
  splitProvider,
  thinkingAfterModelChange,
  thinkingOptions,
  type SelectOption,
} from "./schedule-options";

export function ProviderFields({
  provider,
  mode,
  thinking,
  cwd,
  onChange,
}: Pick<JobInput, "provider" | "mode" | "thinking" | "cwd"> & {
  onChange: (patch: Partial<Pick<JobInput, "provider" | "mode" | "thinking">>) => void;
}) {
  const paseo = usePaseo();
  const scope = cwd ? { cwd } : {};
  const catalog = useQuery({
    queryKey: ["scheduler", "provider-options", cwd],
    queryFn: () => paseo.providers.snapshot(scope),
    staleTime: 30000,
    refetchInterval: (query) =>
      query.state.data?.entries.some((entry) => entry.enabled && entry.status === "loading")
        ? 1000
        : false,
  });
  const selection = splitProvider(provider);
  const entries = catalog.data?.entries ?? [];
  const entry = entries.find((item) => item.provider === selection.provider);
  const loading = catalog.isPending || entry?.status === "loading";
  const refresh = useMutation({
    mutationFn: async () => {
      const result = await paseo.providers.refresh(scope);
      if (!result.acknowledged)
        throw new Error("The host did not accept the provider refresh. Try again.");
    },
    onSuccess: async () => {
      await catalog.refetch();
    },
  });
  const pinnedMode = entry?.status === "ready" ? defaultModeId(entry) : "";
  useEffect(() => {
    if (!mode && pinnedMode) onChange({ mode: pinnedMode });
  }, [mode, pinnedMode, onChange]);
  const availabilityError =
    entry?.error ??
    (entry && entry.status === "unavailable" ? "This provider is unavailable on the host." : null);
  return (
    <View style={{ gap: 4 }}>
      <Grid>
        <Select
          label="Provider"
          value={selection.provider}
          options={providerOptions(entries, selection.provider)}
          disabled={catalog.isPending}
          onChange={(next) => {
            if (next !== selection.provider) onChange({ provider: next, mode: "", thinking: "" });
          }}
        />
        <CatalogSelect
          key={`model:${selection.provider}`}
          label="Model"
          value={selection.model}
          options={modelOptions(entry, selection.model)}
          disabled={loading}
          onChange={(model) => {
            if (model === selection.model) return;
            onChange({
              provider: providerModel(selection.provider, model),
              thinking: thinkingAfterModelChange(entry, model, thinking),
            });
          }}
        />
        <CatalogSelect
          key={`mode:${selection.provider}`}
          label="Mode"
          value={mode}
          options={modeOptions(entry, mode)}
          disabled={loading}
          hint={entry?.modes?.find((item) => item.id === mode)?.description}
          onChange={(next) => onChange({ mode: next })}
        />
        <CatalogSelect
          key={`thinking:${provider}`}
          label="Thinking"
          value={thinking}
          options={thinkingOptions(entry, selection.model, thinking)}
          disabled={loading}
          onChange={(next) => onChange({ thinking: next })}
        />
      </Grid>
      {loading ? <Copy muted>Loading provider options…</Copy> : null}
      <Notice
        error
        message={catalog.error?.message ?? availabilityError ?? refresh.error?.message}
      />
      <Row>
        <Action
          ghost
          label={
            refresh.isPending || catalog.isFetching ? "Refreshing options…" : "Refresh options"
          }
          disabled={refresh.isPending || catalog.isFetching}
          onPress={() => refresh.mutate()}
        />
      </Row>
    </View>
  );
}

function CatalogSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const [custom, setCustom] = useState(false);
  const choices = preserveSelection(options, value).map((option) => ({
    value: `value:${option.value}`,
    label: option.label,
  }));
  choices.push({ value: "custom", label: "Custom value…" });
  return (
    <View style={{ gap: 6 }}>
      {custom ? (
        <Field
          label={`Custom ${label.toLowerCase()}`}
          value={value}
          onChange={onChange}
          hint="Use this only for a value not advertised by the provider."
        />
      ) : (
        <Select
          label={label}
          value={`value:${value}`}
          options={choices}
          onChange={(next) => {
            if (next === "custom") setCustom(true);
            else onChange(next.slice("value:".length));
          }}
          disabled={disabled}
          hint={hint}
        />
      )}
      {custom ? (
        <Action
          label={`Choose ${label.toLowerCase()} from list`}
          onPress={() => setCustom(false)}
        />
      ) : null}
    </View>
  );
}
