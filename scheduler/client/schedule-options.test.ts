import { describe, expect, it } from "vitest";
import {
  combineOffset,
  defaultModeId,
  modelOptions,
  modeOptions,
  preserveSelection,
  providerModel,
  providerOptions,
  splitOffset,
  splitProvider,
  thinkingAfterModelChange,
  thinkingOptions,
  toggleWeekday,
  type ProviderEntry,
} from "./schedule-options";

const entry: ProviderEntry = {
  provider: "custom",
  label: "Custom provider",
  status: "ready",
  enabled: true,
  defaultModeId: "auto",
  models: [
    {
      provider: "custom",
      id: "default-model",
      label: "Default model",
      isDefault: true,
      thinkingOptions: [
        { id: "high", label: "High" },
        { id: "max", label: "Max" },
      ],
    },
    {
      provider: "custom",
      id: "vendor/model-v2",
      aliases: ["old-model-alias"],
      label: "Other model",
      thinkingOptions: [{ id: "high", label: "High" }],
    },
    { provider: "custom", id: "hidden", label: "Hidden model", isSelectable: false },
  ],
  modes: [
    { id: "auto", label: "Auto mode" },
    { id: "plan", label: "Plan mode" },
  ],
};

describe("schedule selection behavior", () => {
  it("round-trips provider selections without discarding slashes in model IDs", () => {
    const split = splitProvider("custom/vendor/model-v2");
    expect(split).toEqual({ provider: "custom", model: "vendor/model-v2" });
    expect(providerModel(split.provider, split.model)).toBe("custom/vendor/model-v2");
    expect(providerModel("custom", "")).toBe("custom");
  });

  it("offers the provider default model without materializing it as a pinned model ID", () => {
    expect(modelOptions(entry, "")[0]).toEqual({
      value: "",
      label: "Provider default (Default model)",
    });
    expect(thinkingOptions(entry, "", "max")).toEqual([
      { value: "", label: "Model default" },
      { value: "high", label: "High" },
      { value: "max", label: "Max" },
    ]);
  });

  it("pins the provider default mode because the daemon does not apply it to runs", () => {
    expect(defaultModeId(entry)).toBe("auto");
    expect(modeOptions(entry, "auto")).toEqual([
      { value: "auto", label: "Auto mode (provider default)" },
      { value: "plan", label: "Plan mode" },
    ]);
  });

  it("offers an unpinned mode only when the provider advertises no usable default", () => {
    const noDefault = { ...entry, defaultModeId: null };
    const staleDefault = { ...entry, defaultModeId: "removed" };
    expect(defaultModeId(noDefault)).toBe("");
    expect(defaultModeId(staleDefault)).toBe("");
    expect(defaultModeId(undefined)).toBe("");
    expect(modeOptions(noDefault, "")[0]).toEqual({ value: "", label: "Provider default" });
  });

  it("keeps a saved model alias selectable without advertising hidden models", () => {
    expect(modelOptions(entry, "old-model-alias")).toEqual([
      { value: "", label: "Provider default (Default model)" },
      { value: "default-model", label: "Default model" },
      { value: "vendor/model-v2", label: "Other model" },
      { value: "old-model-alias", label: "Other model (old-model-alias)" },
    ]);
  });

  it("preserves saved values during discovery failures without changing the catalog", () => {
    const options = [{ value: "", label: "Default" }];
    expect(preserveSelection(options, "legacy-mode")).toEqual([
      ...options,
      { value: "legacy-mode", label: "legacy-mode (current value)" },
    ]);
    expect(options).toEqual([{ value: "", label: "Default" }]);
    expect(thinkingOptions(undefined, "", "max")).toContainEqual({
      value: "max",
      label: "max (current value)",
    });
  });

  it("preserves supported thinking when changing model, and clears unsupported thinking", () => {
    expect(thinkingAfterModelChange(entry, "vendor/model-v2", "max")).toBe("");
    expect(thinkingAfterModelChange(entry, "vendor/model-v2", "high")).toBe("high");
    expect(thinkingAfterModelChange(entry, "", "max")).toBe("max");
  });

  it("offers enabled custom providers while preserving a disabled saved provider", () => {
    const disabled = { ...entry, provider: "disabled-provider", enabled: false };
    expect(providerOptions([entry, disabled], "custom")).toEqual([
      { value: "custom", label: "Custom provider" },
    ]);
    expect(providerOptions([entry, disabled], "disabled-provider")).toContainEqual({
      value: "disabled-provider",
      label: "disabled-provider (current value)",
    });
  });

  it("keeps arbitrary minute offsets when editing through hour and minute selectors", () => {
    for (const offset of ["-720", "-137", "-17", "0", "17", "137", "719", "720"]) {
      expect(combineOffset(splitOffset(offset))).toBe(offset);
    }
    expect(combineOffset({ direction: "before", hours: "12", minutes: "59" })).toBe("-720");
  });

  it("keeps at least one weekday selected and stores selections in calendar order", () => {
    expect(toggleWeekday("7", "7")).toBe("7");
    expect(toggleWeekday("1,5,7", "3")).toBe("1,3,5,7");
    expect(toggleWeekday("1,3,5,7", "3")).toBe("1,5,7");
  });
});
