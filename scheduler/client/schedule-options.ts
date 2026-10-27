import type { PaseoProviderSnapshotResult } from "@getpaseo/client";

export interface SelectOption {
  value: string;
  label: string;
}
export type ProviderEntry = PaseoProviderSnapshotResult["entries"][number];

export function splitProvider(value: string) {
  const slash = value.indexOf("/");
  if (slash < 0) return { provider: value, model: "" };
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}

export function providerModel(provider: string, model: string): string {
  return model ? `${provider}/${model}` : provider;
}

/** A catalog refresh must never silently replace a stored selection. */
export function preserveSelection(options: readonly SelectOption[], value: string): SelectOption[] {
  if (!value || options.some((option) => option.value === value)) return [...options];
  return [...options, { value, label: `${value} (current value)` }];
}

export function selectedModel(entry: ProviderEntry | undefined, model: string) {
  if (!model) return entry?.models?.find((item) => item.isDefault);
  return entry?.models?.find((item) => item.id === model || item.aliases?.includes(model));
}

export function providerOptions(entries: ProviderEntry[], value: string): SelectOption[] {
  const options = entries
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      value: entry.provider,
      label: entry.label ?? entry.provider,
    }));
  return preserveSelection(options, value);
}

export function modelOptions(entry: ProviderEntry | undefined, value: string): SelectOption[] {
  const models = entry?.models ?? [];
  const defaultModel = selectedModel(entry, "");
  const defaultLabel = defaultModel
    ? `Provider default (${defaultModel.label})`
    : "Provider default";
  const options = [
    { value: "", label: defaultLabel },
    ...models
      .filter((model) => model.isSelectable !== false)
      .map((model) => ({ value: model.id, label: model.label })),
  ];
  const alias = selectedModel(entry, value);
  if (alias && alias.id !== value && value)
    options.push({ value, label: `${alias.label} (${value})` });
  return preserveSelection(options, value);
}

/**
 * The daemon does not apply a provider's advertised default mode when `paseo run`
 * omits `--mode` (Claude falls back to "Always Ask"), so a schedule must pin it.
 */
export function defaultModeId(entry: ProviderEntry | undefined): string {
  const id = entry?.defaultModeId;
  return id && entry?.modes?.some((mode) => mode.id === id) ? id : "";
}

export function modeOptions(entry: ProviderEntry | undefined, value: string): SelectOption[] {
  const modes = entry?.modes ?? [];
  const options = modes.map((mode) => ({
    value: mode.id,
    label: mode.id === entry?.defaultModeId ? `${mode.label} (provider default)` : mode.label,
  }));
  if (!defaultModeId(entry)) options.unshift({ value: "", label: "Provider default" });
  return preserveSelection(options, value);
}

export function thinkingOptions(
  entry: ProviderEntry | undefined,
  model: string,
  value: string,
): SelectOption[] {
  const choices = selectedModel(entry, model)?.thinkingOptions ?? [];
  return preserveSelection(
    [
      { value: "", label: "Model default" },
      ...choices.map((choice) => ({ value: choice.id, label: choice.label })),
    ],
    value,
  );
}

export function thinkingAfterModelChange(
  entry: ProviderEntry | undefined,
  model: string,
  current: string,
): string {
  return selectedModel(entry, model)?.thinkingOptions?.some((option) => option.id === current)
    ? current
    : "";
}

export function numberedOptions(count: number): SelectOption[] {
  return Array.from({ length: count }, (_, index) => ({
    value: String(index).padStart(2, "0"),
    label: String(index).padStart(2, "0"),
  }));
}
export const hours = numberedOptions(24);
export const minutes = numberedOptions(60);
export const offsetHours = numberedOptions(13);
export const runTimeOptions = [
  { value: "fixed", label: "Fixed time" },
  { value: "open", label: "Relative to market open" },
  { value: "close", label: "Relative to market close" },
] as const;
export const weekdays: SelectOption[] = [
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
  { value: "7", label: "Sunday" },
];

function ordinalLabel(value: number): string {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  const suffixes: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };
  return `${value}${suffixes[value % 10] ?? "th"}`;
}

export function ordinalOptions(limit: number): SelectOption[] {
  return [
    { value: "-1", label: "Last" },
    ...Array.from({ length: limit - 1 }, (_, index) => ({
      value: String(-index - 2),
      label: `${ordinalLabel(index + 2)} from last`,
    })),
    ...Array.from({ length: limit }, (_, index) => ({
      value: String(index + 1),
      label: ordinalLabel(index + 1),
    })),
  ];
}

export function toggleWeekday(value: string, weekday: string): string {
  const selected = new Set(value.split(","));
  if (selected.has(weekday)) {
    if (selected.size === 1) return value;
    selected.delete(weekday);
  } else selected.add(weekday);
  return [...selected].sort().join(",");
}

export interface OffsetParts {
  direction: "before" | "after";
  hours: string;
  minutes: string;
}
export function splitOffset(value: string): OffsetParts {
  const amount = Math.abs(Number(value));
  return {
    direction: value.startsWith("-") ? "before" : "after",
    hours: String(Math.floor(amount / 60)).padStart(2, "0"),
    minutes: String(amount % 60).padStart(2, "0"),
  };
}
export function combineOffset(parts: OffsetParts): string {
  const amount = Math.min(720, Number(parts.hours) * 60 + Number(parts.minutes));
  return parts.direction === "before" ? `-${amount}` : String(amount);
}

export const timeZones: SelectOption[] = [
  { value: "Asia/Shanghai", label: "China — Asia/Shanghai" },
  { value: "Asia/Hong_Kong", label: "Hong Kong — Asia/Hong_Kong" },
  { value: "America/New_York", label: "US Eastern — America/New_York" },
  { value: "America/Chicago", label: "US Central — America/Chicago" },
  { value: "America/Los_Angeles", label: "US Pacific — America/Los_Angeles" },
  { value: "Asia/Tokyo", label: "Japan — Asia/Tokyo" },
  { value: "Asia/Singapore", label: "Singapore — Asia/Singapore" },
  { value: "Europe/London", label: "UK — Europe/London" },
  { value: "Europe/Berlin", label: "Central Europe — Europe/Berlin" },
  { value: "Australia/Sydney", label: "Sydney — Australia/Sydney" },
  { value: "UTC", label: "UTC" },
];
