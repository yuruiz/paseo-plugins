import { FLEET_ORIGIN, isFleetOrigin } from "../shared/fleet";
import { useFleet } from "./fleet";
import { openExternalUrl, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { UsageGranularity, UsageRangeKey } from "../shared/usage";
import { ConfigScreen } from "./config";
import { Dashboard } from "./dashboard";
import { fromAgentReport, fromReport } from "./dashboard-data";
import { DateRangePicker } from "./date-range";
import { PREFS_QUERY_KEY, useAgentReport, usePrefs, useRefreshUsage, useSetPrefs, useUpdateCheck, useUsageReport } from "./data";
import { detectSystemLocale, useI18n, type Translate } from "./i18n";
import { ISSUE_URL, PULL_REQUEST_URL } from "./links";

type SelectKey = "device" | "agent" | "range" | "granularity";
interface SelectOption { value: string; label: string }
interface SelectSpec { title: string; value: string; options: SelectOption[]; onSelect: (value: string) => void }

const RANGE_KEYS: UsageRangeKey[] = ["24h", "today", "7d", "30d", "12w", "12m", "custom"];
const RANGE_LABEL_KEYS = ["range.24h", "range.today", "range.7d", "range.30d", "range.12w", "range.12m", "range.custom"] as const;
const GRANULARITY_KEYS: UsageGranularity[] = ["hour", "day", "week", "month"];
const GRANULARITY_LABEL_KEYS = ["granularity.hour", "granularity.day", "granularity.week", "granularity.month"] as const;

function defaultCustomRange(): { from: string; to: string } {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  const key = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  return { from: key(start), to: key(today) };
}

function originStatusText(t: Translate, status: string, lastPullAt: number | null): string {
  if (status === "pulling") return t("origin.pulling");
  if (status === "error") return t("origin.error");
  if (status === "never") return t("origin.never");
  if (lastPullAt) {
    const date = new Date(lastPullAt);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return t("origin.synced", { time: `${hours}:${minutes}` });
  }
  return t("origin.ok");
}

function openCommunityLink(url: string) {
  void openExternalUrl(url).catch((error) => {
    console.error("Failed to open Agent Usage community link", error);
  });
}

export function UsageScreen(props: PluginScreenProps) {
  const { theme, layout } = props;
  const [range, setRange] = useState<UsageRangeKey | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [device, setDevice] = useState<string>(FLEET_ORIGIN);
  const [tab, setTab] = useState<string>("overview");
  const [granularity, setGranularity] = useState<UsageGranularity | null>(null);
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [showNotes, setShowNotes] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [dismissingCommunity, setDismissingCommunity] = useState(false);
  const [openSelect, setOpenSelect] = useState<SelectKey | null>(null);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const queryClient = useQueryClient();
  const setPrefs = useSetPrefs();
  const toast = useToast();
  const updateQuery = useUpdateCheck();
  const prefsQuery = usePrefs(detectSystemLocale());
  const deviceOrigin = device === "aggregate" ? undefined : device;
  const effectiveRange = range ?? prefsQuery.data?.defaultRange ?? "7d";
  const effectiveGranularity = granularity ?? prefsQuery.data?.defaultGranularity ?? "day";
  const customPayload = useMemo(() => {
    if (effectiveRange !== "custom" || !customFrom || !customTo) return undefined;
    return { from: customFrom, to: customTo };
  }, [effectiveRange, customFrom, customTo]);
  const query = useUsageReport(effectiveRange, deviceOrigin, customPayload, effectiveGranularity);

  function chooseRange(next: UsageRangeKey) {
    setRange(next);
    if (next === "custom" && (!customFrom || !customTo)) {
      const defaults = defaultCustomRange();
      setCustomFrom(defaults.from);
      setCustomTo(defaults.to);
    }
    setOpenSelect(null);
    setShowCustomPicker(false);
  }
  const refreshUsage = useRefreshUsage(deviceOrigin);
  const fleetQuery = useFleet();
  const { t } = useI18n();

  async function dismissCommunityBanner() {
    const current = prefsQuery.data;
    if (!current || dismissingCommunity) return;
    setDismissingCommunity(true);
    const next = { ...current, coCreateDismissed: true };
    try {
      await queryClient.cancelQueries({ queryKey: PREFS_QUERY_KEY });
      const result = await setPrefs(next);
      if (!result.saved) {
        toast.error(result.error ?? t("community.dismissFailed"));
        return;
      }
      queryClient.setQueryData(PREFS_QUERY_KEY, next);
    } catch {
      toast.error(t("community.dismissFailed"));
    } finally {
      setDismissingCommunity(false);
    }
  }

  const localLabel = prefsQuery.data?.localAlias || t("origin.local");
  const ranges = useMemo(() => RANGE_KEYS.map((key, index) => ({ key, label: t(RANGE_LABEL_KEYS[index]) })), [t]);
  const rangeDisplay = useMemo(() => {
    const customLabel = t("range.custom");
    if (effectiveRange !== "custom" || !customFrom || !customTo) return ranges.find((item) => item.key === effectiveRange)?.label ?? effectiveRange;
    return `${customLabel} ${customFrom.replace(/-/g, "/")}-${customTo.replace(/-/g, "/")}`;
  }, [effectiveRange, customFrom, customTo, ranges, t]);
  const granularities = useMemo(
    () => GRANULARITY_KEYS.map((key, index) => ({ value: key, label: t(GRANULARITY_LABEL_KEYS[index]) })),
    [t],
  );
  const compact = layout.compact;
  const styles = useMemo(
    () =>
      ({
        screen: { flex: 1, backgroundColor: theme.colors.surface0 },
        content: { padding: compact ? 12 : 16, gap: compact ? 10 : 12, paddingBottom: 48 },
        headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
        headerActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, flexShrink: 1, flexWrap: "wrap" },
        title: { fontSize: 17, fontWeight: "700", color: theme.colors.foreground },
        subtitle: { fontSize: 10, color: theme.colors.foregroundMuted },
        buttonRow: { flexDirection: "row", gap: 5 },
        refreshButton: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: theme.colors.surface1 },
        refreshText: { fontSize: 11, color: theme.colors.foreground },
        toolbar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 6, flexShrink: 1 },
        dateButton: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1 },
        dateButtonText: { fontSize: 10, color: theme.colors.foreground },
        communityBanner: {
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          backgroundColor: theme.colors.surface2,
          borderColor: theme.colors.border,
          borderLeftColor: theme.colors.accent,
          borderWidth: 1,
          borderLeftWidth: 3,
          borderRadius: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
        },
        communityBody: { flex: 1, minWidth: compact ? "100%" : 240, flexDirection: "row", alignItems: "center", gap: 8 },
        communityText: { flex: 1, fontSize: 12, color: theme.colors.foreground, lineHeight: 18 },
        communityTitle: { color: theme.colors.accent, fontWeight: "700" },
        communityActions: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
        communityAction: {
          minHeight: 34,
          justifyContent: "center",
          paddingHorizontal: 8,
          paddingVertical: 5,
          borderRadius: 6,
          backgroundColor: theme.colors.surface1,
        },
        communityActionText: { fontSize: 11, fontWeight: "600", color: theme.colors.accent },
        communityDismiss: { minWidth: 28, minHeight: 28, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, paddingVertical: 2 },
        communityDismissText: { fontSize: 12, color: theme.colors.foregroundMuted },
        banner: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 10 },
        bannerText: { fontSize: 11, color: theme.colors.foregroundMuted },
        updateBanner: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
        },
        updateText: { flex: 1, fontSize: 11, color: theme.colors.foreground, lineHeight: 16 },
        updateDismiss: { paddingHorizontal: 4, paddingVertical: 2 },
        updateDismissText: { fontSize: 12, color: theme.colors.foregroundMuted },
        footer: { fontSize: 10, color: theme.colors.foregroundMuted, lineHeight: 15 },
        section: { backgroundColor: theme.colors.surface1, borderRadius: 10, padding: 12, gap: 8 },
        sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
        sectionTitle: { fontSize: 12, fontWeight: "600", color: theme.colors.foreground },
        notesToggle: { fontSize: 11, color: theme.colors.foregroundMuted },
        notesText: { fontSize: 11, color: theme.colors.foregroundMuted, lineHeight: 16 },
      }) satisfies Record<string, ViewStyle | TextStyle>,
    [theme, compact],
  );

  const data = query.data;
  const deviceTabs = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [
      { id: FLEET_ORIGIN, label: t("fleet.all") },
      { id: "aggregate", label: t("fleet.selected") },
    ];
    for (const host of fleetQuery.fleet.hosts) {
      list.push({ id: host.name, label: fleetQuery.fleet.labels.get(host.name) ?? host.name });
    }
    for (const origin of data?.origins ?? []) {
      if (!isFleetOrigin(origin.id)) list.push({ id: origin.id, label: origin.id === "local" ? localLabel : origin.label });
    }
    return list;
  }, [data?.origins, t, localLabel, fleetQuery.fleet]);
  const hasDevice = deviceTabs.some((item) => item.id === device);
  const activeDevice = hasDevice ? device : FLEET_ORIGIN;
  useEffect(() => {
    if (isFleetOrigin(device) && device !== FLEET_ORIGIN && !hasDevice) setDevice(FLEET_ORIGIN);
  }, [device, hasDevice]);
  const selectedOrigin = (data?.origins ?? []).find((origin) => origin.id === activeDevice) ?? null;
  const failedOrigins = (data?.origins ?? []).filter((origin) => origin.id !== "local" && origin.status === "error");

  const tabs = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [{ id: "overview", label: t("tab.overview") }];
    for (const agent of data?.agents ?? []) {
      list.push({ id: agent.id, label: agent.label });
    }
    return list;
  }, [data?.agents, t]);
  const hasTab = tabs.some((item) => item.id === tab);
  const activeTab = hasTab ? tab : "overview";
  const agentQuery = useAgentReport(activeTab === "overview" ? "claude" : activeTab, effectiveRange, activeTab !== "overview", deviceOrigin, customPayload, effectiveGranularity);
  const dashboardData = activeTab === "overview" ? (data ? fromReport(data) : null) : agentQuery.data ? fromAgentReport(agentQuery.data) : null;
  const selectSpec: SelectSpec | null =
    openSelect === "device"
      ? { title: t("toolbar.device"), value: activeDevice, options: deviceTabs.map((item) => ({ value: item.id, label: item.label })), onSelect: (value) => setDevice(value) }
      : openSelect === "agent"
        ? { title: t("toolbar.agent"), value: activeTab, options: tabs.map((item) => ({ value: item.id, label: item.label })), onSelect: (value) => setTab(value) }
        : openSelect === "range"
          ? {
              title: t("toolbar.range"),
              value: effectiveRange,
              options: ranges.map((item) => ({ value: item.key, label: item.label })),
              onSelect: (value) => chooseRange(value as UsageRangeKey),
            }
          : openSelect === "granularity"
            ? {
                title: t("toolbar.granularity"),
                value: effectiveGranularity,
                options: granularities.map((item) => ({ value: item.value, label: item.label })),
                onSelect: (value) => setGranularity(value as UsageGranularity),
              }
            : null;

  if (showSettings) {
    return <ConfigScreen {...props} onBack={() => setShowSettings(false)} />;
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={styles.title}>{t("app.title")}</Text>
            <Text numberOfLines={1} style={[styles.subtitle, { flexShrink: 1 }]}>{data?.firstDay ? t("app.subtitleSince", { day: data.firstDay }) : t("app.subtitle")}</Text>
          </View>
          <View style={styles.headerActions}>
            <View style={styles.toolbar}>
              <CompactSelect
                theme={theme}
                compact={compact}
                label={t("toolbar.device")}
                value={deviceTabs.find((item) => item.id === activeDevice)?.label ?? activeDevice}
                onPress={() => setOpenSelect("device")}
              />
              <CompactSelect
                theme={theme}
                compact={compact}
                label={t("toolbar.agent")}
                value={tabs.find((item) => item.id === activeTab)?.label ?? activeTab}
                onPress={() => setOpenSelect("agent")}
              />
              <CompactSelect
                theme={theme}
                compact={compact}
                label={t("toolbar.range")}
                value={rangeDisplay}
                grow
                onPress={() => setOpenSelect("range")}
              />
              <CompactSelect
                theme={theme}
                compact={compact}
                label={t("toolbar.granularity")}
                value={granularities.find((item) => item.value === effectiveGranularity)?.label ?? effectiveGranularity}
                onPress={() => setOpenSelect("granularity")}
              />
              {effectiveRange === "custom" ? (
                <Pressable accessibilityRole="button" onPress={() => setShowCustomPicker((value) => !value)} style={styles.dateButton}>
                  <Text style={styles.dateButtonText}>{showCustomPicker ? t("toolbar.hideDates") : t("toolbar.editDates")}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.buttonRow}>
              <Pressable accessibilityRole="button" accessibilityLabel={t("app.a11yOpenConfig")} style={styles.refreshButton} onPress={() => setShowSettings(true)}>
                <Text style={styles.refreshText}>{t("app.config")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("app.a11yRefresh")}
                style={styles.refreshButton}
                onPress={() => {
                  void refreshUsage({}).then(async (result) => {
                    if (isFleetOrigin(deviceOrigin) && !result.started) throw new Error("No host available");
                    await Promise.all([query.refetch(), agentQuery.refetch()]);
                    await queryClient.invalidateQueries({ queryKey: ["agent-usage-fleet"] });
                  }).catch(() => toast.error(t("fleet.refreshFailed")));
                }}
              >
                <Text style={styles.refreshText}>{query.isFetching ? t("app.refreshing") : t("app.refresh")}</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {prefsQuery.data && !prefsQuery.data.coCreateDismissed ? (
          <View style={styles.communityBanner}>
            <View style={styles.communityBody}>
              <Icon name="Sparkles" size={15} color={theme.colors.accent} />
              <Text style={styles.communityText}>
                <Text style={styles.communityTitle}>{t("community.title")}</Text>
                {` · ${t("community.hint")}`}
              </Text>
            </View>
            <View style={styles.communityActions}>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t("community.issueA11y")}
                hitSlop={6}
                onPress={() => openCommunityLink(ISSUE_URL)}
                style={styles.communityAction}
              >
                <Text style={styles.communityActionText}>{t("community.issue")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t("community.prA11y")}
                hitSlop={6}
                onPress={() => openCommunityLink(PULL_REQUEST_URL)}
                style={styles.communityAction}
              >
                <Text style={styles.communityActionText}>{t("community.pr")}</Text>
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("community.dismissA11y")}
              accessibilityState={{ disabled: dismissingCommunity }}
              disabled={dismissingCommunity}
              hitSlop={8}
              onPress={() => void dismissCommunityBanner()}
              style={styles.communityDismiss}
            >
              <Text style={styles.communityDismissText}>✕</Text>
            </Pressable>
          </View>
        ) : null}

        {updateQuery.data?.updateAvailable && !updateDismissed ? (
          <View style={styles.updateBanner}>
            <Text style={styles.updateText}>{t("update.available", { latest: updateQuery.data.latestVersion, current: updateQuery.data.currentVersion })}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("update.dismiss")} onPress={() => setUpdateDismissed(true)} style={styles.updateDismiss}>
              <Text style={styles.updateDismissText}>✕</Text>
            </Pressable>
          </View>
        ) : null}

        {effectiveRange === "custom" && showCustomPicker ? (
          <DateRangePicker
            theme={theme}
            compact={compact}
            from={customFrom}
            to={customTo}
            onChange={(next) => {
              if (!next.from && !next.to) {
                setCustomFrom("");
                setCustomTo("");
                chooseRange("7d");
                return;
              }
              setCustomFrom(next.from);
              setCustomTo(next.to);
            }}
          />
        ) : null}

        {isFleetOrigin(activeDevice) ? (
          <Text style={styles.footer}>
            {t(fleetQuery.fleet.partial ? "fleet.partial" : "fleet.ready", { ready: fleetQuery.fleet.ready, total: fleetQuery.fleet.total })}
            {fleetQuery.fleet.partial ? ` · ${t("fleet.partialHint")}` : ""}
          </Text>
        ) : null}
        {activeDevice !== "aggregate" && selectedOrigin ? (
          <Text style={styles.footer}>
            {selectedOrigin.id === "local" ? localLabel : selectedOrigin.label} · {originStatusText(t, selectedOrigin.status, selectedOrigin.lastPullAt)}
            {selectedOrigin.lastError ? ` · ${isFleetOrigin(activeDevice) ? t("fleet.partialHint") : selectedOrigin.lastError}` : ""}
          </Text>
        ) : null}
        {activeDevice === "aggregate"
          ? failedOrigins.map((origin) => (
              <Text key={origin.id} style={styles.footer}>
                {t("origin.pullFailed", { label: origin.label, error: origin.lastError ?? "" })}
              </Text>
            ))
          : null}

        {data?.scanning ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {t("scan.scanning", { done: data.scanDone, total: Math.max(data.scanTotal, 1) })}
              {data.firstDay ? "" : t("scan.firstHint")}
            </Text>
          </View>
        ) : null}
        {data?.scanError && !data.scanning ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{t("scan.error", { error: data.scanError })}</Text>
          </View>
        ) : null}

        {dashboardData ? (
          <Dashboard data={dashboardData} scope={activeTab === "overview" ? "aggregate" : "agent"} theme={theme} compact={compact} />
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{activeTab === "overview" ? (data?.scanning ? t("empty.preparing") : t("empty.noData")) : t("common.loading")}</Text>
            <Text style={styles.footer}>{activeTab === "overview" ? (data?.scanning ? t("empty.firstScan") : t("empty.none")) : ""}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Pressable style={styles.sectionHeader} onPress={() => setShowNotes((value) => !value)}>
            <Text style={styles.sectionTitle}>{t("notes.title")}</Text>
            <Text style={styles.notesToggle}>{showNotes ? t("notes.collapse") : t("notes.expand")}</Text>
          </Pressable>
          {showNotes ? (
            <View style={{ gap: 6 }}>
              <Text style={styles.notesText}>{t("notes.item1")}</Text>
              <Text style={styles.notesText}>{t("notes.item2")}</Text>
              <Text style={styles.notesText}>{t("notes.item3")}</Text>
              <Text style={styles.notesText}>{t("notes.item4")}</Text>
              <Text style={styles.notesText}>{t("notes.item5")}</Text>
            </View>
          ) : (
            <Text style={styles.footer}>{t("notes.collapsedHint")}</Text>
          )}
        </View>
      </ScrollView>
      {selectSpec ? (
        <SelectOverlay
          theme={theme}
          compact={compact}
          title={selectSpec.title}
          value={selectSpec.value}
          options={selectSpec.options}
          onSelect={(value) => {
            selectSpec.onSelect(value);
            setOpenSelect(null);
          }}
          onClose={() => setOpenSelect(null)}
          closeLabel={t("common.close")}
        />
      ) : null}
    </View>
  );
}
function CompactSelect({
  theme,
  compact,
  label,
  value,
  onPress,
  grow = false,
}: {
  theme: PluginScreenProps["theme"];
  compact: boolean;
  label: string;
  value: string;
  onPress: () => void;
  grow?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        maxWidth: compact ? (grow ? "100%" : "48%") : undefined,
      }}
    >
      <Text style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>{label}</Text>
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 11, fontWeight: "600", color: theme.colors.foreground }}>{value}</Text>
      <Text style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>▾</Text>
    </Pressable>
  );
}

function SelectOverlay({
  theme,
  compact,
  title,
  value,
  options,
  onSelect,
  onClose,
  closeLabel,
}: {
  theme: PluginScreenProps["theme"];
  compact: boolean;
  title: string;
  value: string;
  options: readonly SelectOption[];
  onSelect: (value: string) => void;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, elevation: 20 }}>
      <Pressable accessible={false} onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.35)" }} />
      <View
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
        style={{
          marginTop: compact ? 64 : 84,
          alignSelf: "center",
          width: compact ? "92%" : 420,
          maxHeight: compact ? 430 : 520,
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 12,
          padding: 12,
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 13, fontWeight: "700", color: theme.colors.foreground }}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} style={{ padding: 4 }}>
            <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>✕</Text>
          </Pressable>
        </View>
        <ScrollView style={{ maxHeight: compact ? 360 : 440 }}>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(option.value)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 9,
                  paddingHorizontal: 8,
                  borderRadius: 6,
                  backgroundColor: active ? theme.colors.surface2 : "transparent",
                }}
              >
                <Text style={{ flex: 1, fontSize: 12, color: active ? theme.colors.foreground : theme.colors.foregroundMuted, fontWeight: active ? "600" : "400" }}>{option.label}</Text>
                {active ? <Text style={{ fontSize: 11, color: theme.colors.accent }}>✓</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}
