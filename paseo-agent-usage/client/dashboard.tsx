import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { DASHBOARD_MAX_CARDS, DASHBOARD_MAX_PAGES } from "../shared/usage";
import type { DashboardCard, DashboardConfig, DashboardPage } from "../shared/usage";
import {
  addCard,
  addPage,
  cardDescription,
  cardTitle,
  CARD_CATALOG,
  deletePage,
  isCardId,
  moveCard,
  movePage,
  pageCopy,
  pageHint,
  pageTitle,
  PAGE_ORDER,
  removeCard,
  renamePage,
  resetAll,
  resetPage,
  sanitizeDashboard,
  splitRows,
  toggleCardHidden,
  toggleCardSpan,
  togglePageHidden,
  visiblePageCards,
  visiblePages,
  type CardId,
  type DashboardScope,
  type PageId,
} from "./dashboard-model";
import type { DashboardData } from "./dashboard-data";
import { PREFS_QUERY_KEY, usePrefs, useSetPrefs } from "./data";
import { detectSystemLocale, useI18n } from "./i18n";
import { CardFrame } from "./visuals";
import { pick } from "./views/shared";
import {
  AnomalyCard,
  AgentShareCard,
  HostCompareCard,
  PeriodCompareCard,
  PulseCard,
  TrendCard,
} from "./views/overview";
import { AgentModelCard, ModelRankCard, ProjectAgentCard, ProjectRankCard, TokenCompositionCard, TreemapCard } from "./views/composition";
import { AvgRequestCard, CacheFlowCard, CacheHitCard, CostCard, CumulativeCard, EfficiencyQuadrantCard, IoStructureCard } from "./views/efficiency";
import { ActivityCard, CalendarCard, HourlyCard, PunchcardCard, TimeAgentCard, WeekdayCard } from "./views/rhythm";
import { RecentPaceCard, RequestLogCard, RequestSizeCard, SessionDistributionCard, SessionScatterCard, SessionTableCard, SwimlaneCard, TopSessionsCard } from "./views/sessions";
import { AgentRadarCard, BudgetCard, CoverageCard } from "./views/compare";
import type { CardProps } from "./views/shared";

const CARD_COMPONENTS: Record<CardId, ComponentType<CardProps>> = {
  pulse: PulseCard,
  trend: TrendCard,
  periodCompare: PeriodCompareCard,
  anomaly: AnomalyCard,
  agentShare: AgentShareCard,
  hostCompare: HostCompareCard,
  tokenComposition: TokenCompositionCard,
  modelRank: ModelRankCard,
  projectRank: ProjectRankCard,
  agentModel: AgentModelCard,
  projectAgent: ProjectAgentCard,
  treemap: TreemapCard,
  cacheHit: CacheHitCard,
  cacheFlow: CacheFlowCard,
  avgRequest: AvgRequestCard,
  ioStructure: IoStructureCard,
  efficiencyQuadrant: EfficiencyQuadrantCard,
  cost: CostCard,
  cumulative: CumulativeCard,
  calendar: CalendarCard,
  punchcard: PunchcardCard,
  hourly: HourlyCard,
  weekday: WeekdayCard,
  activity: ActivityCard,
  timeAgent: TimeAgentCard,
  sessionScatter: SessionScatterCard,
  sessionDistribution: SessionDistributionCard,
  topSessions: TopSessionsCard,
  swimlane: SwimlaneCard,
  requestSize: RequestSizeCard,
  recentPace: RecentPaceCard,
  sessionTable: SessionTableCard,
  requestLog: RequestLogCard,
  agentRadar: AgentRadarCard,
  budget: BudgetCard,
  coverage: CoverageCard,
};

type Mode = "browse" | "edit" | "pages" | "picker";
type Persist = (next: DashboardConfig | ((current: DashboardConfig) => DashboardConfig)) => void;

export function Dashboard({ data, scope, theme, compact }: { data: DashboardData; scope: DashboardScope; theme: PluginScreenProps["theme"]; compact: boolean }) {
  const { locale, t } = useI18n();
  const prefsQuery = usePrefs(detectSystemLocale());
  const setPrefs = useSetPrefs();
  const queryClient = useQueryClient();
  const prefs = prefsQuery.data;
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  const saveRef = useRef<Promise<void>>(Promise.resolve());
  const [draft, setDraft] = useState<DashboardConfig | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("browse");
  const [error, setError] = useState<string | null>(null);
  const serverConfig = useMemo(() => sanitizeDashboard(prefs?.dashboard), [prefs?.dashboard]);
  const config = draft ?? serverConfig;
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  const canEdit = scope === "aggregate" && Boolean(prefs);

  useEffect(() => {
    if (scope === "agent") {
      setMode("browse");
      setActivePageId(null);
    }
  }, [scope]);

  const pages = useMemo(() => {
    return visiblePages(config)
      .filter((page) => scope === "aggregate" || page.builtin)
      .map((page) => ({ page, cards: visiblePageCards(page, scope) }))
      .filter((item) => (scope === "agent" ? item.cards.length > 0 : true));
  }, [config, scope]);

  const active = pages.find((item) => item.page.id === activePageId) ?? pages[0] ?? null;
  const configPage = active ? config.pages.find((page) => page.id === active.page.id) ?? active.page : null;
  const cards = active ? active.cards : [];
  const cardProps: CardProps = { data, theme, compact, locale, budgetUsd: prefs?.monthlyBudgetUsd, localAlias: prefs?.localAlias };

  const persist: Persist = (nextOrUpdater) => {
    const next = typeof nextOrUpdater === "function" ? nextOrUpdater(configRef.current) : nextOrUpdater;
    configRef.current = next;
    setDraft(next);
    setError(null);
    if (!prefsRef.current) return;
    saveRef.current = saveRef.current.then(async () => {
      const latest = prefsRef.current;
      if (!latest) return;
      const payload = { ...latest, dashboard: next };
      try {
        const result = await setPrefs(payload);
        if (!result.saved) {
          setError(result.error ?? pick(locale, "保存布局失败。", "Failed to save layout."));
          return;
        }
        queryClient.setQueryData(PREFS_QUERY_KEY, payload);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  function openPage(id: string) {
    setActivePageId(id);
    setMode("browse");
  }

  function createPage() {
    if (!canEdit || config.pages.length >= DASHBOARD_MAX_PAGES) return;
    const next = addPage(config, "");
    const created = next.pages[next.pages.length - 1];
    persist(next);
    if (created) setActivePageId(created.id);
    setMode("edit");
  }

  if (mode === "pages" && canEdit) {
    return (
      <PageManager
        config={config}
        theme={theme}
        locale={locale}
        compact={compact}
        activePageId={active?.page.id ?? null}
        setActivePageId={setActivePageId}
        persist={persist}
        getConfig={() => configRef.current}
        onBack={() => setMode("browse")}
      />
    );
  }

  if (mode === "picker" && canEdit && active) {
    return <CardPicker config={config} pageId={active.page.id} theme={theme} locale={locale} persist={persist} onBack={() => setMode("edit")} />;
  }

  return (
    <View style={{ gap: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2, alignItems: "center" }}>
        {pages.map((item) => {
          const selected = item.page.id === active?.page.id;
          return (
            <Pressable
              key={item.page.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => openPage(item.page.id)}
              style={{ paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 2, borderBottomColor: selected ? theme.colors.accent : "transparent" }}
            >
              <Text style={{ fontSize: 11, color: selected ? theme.colors.foreground : theme.colors.foregroundMuted, fontWeight: selected ? "600" : "400" }}>{pageTitle(item.page, locale)}</Text>
            </Pressable>
          );
        })}
        {canEdit ? (
          <>
            <SmallButton theme={theme} label={pick(locale, "页面", "Pages")} onPress={() => setMode("pages")} />
            <SmallButton theme={theme} label="+" accessibilityLabel={pick(locale, "新建页面", "New page")} disabled={config.pages.length >= DASHBOARD_MAX_PAGES} onPress={createPage} />
          </>
        ) : null}
      </ScrollView>

      {error ? <Text style={{ fontSize: 10, color: theme.colors.statusDanger }}>{error}</Text> : null}

      {active && configPage ? (
        <>
          <View style={{ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "flex-end", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: theme.colors.foreground }}>{pageTitle(active.page, locale)}</Text>
              <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{pageHint(active.page, locale)}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 5, flexWrap: "wrap" }}>
              {canEdit ? (
                <>
                  <SmallButton theme={theme} active={mode === "edit"} label={mode === "edit" ? pick(locale, "完成", "Done") : pick(locale, "布局", "Layout")} onPress={() => setMode(mode === "edit" ? "browse" : "edit")} />
                  {mode === "edit" ? <SmallButton theme={theme} label={pick(locale, "添加图表", "Add chart")} onPress={() => setMode("picker")} /> : null}
                  {mode === "edit" ? <SmallButton theme={theme} label={pick(locale, "页面管理", "Manage pages")} onPress={() => setMode("pages")} /> : null}
                  {mode === "edit" && active.page.builtin ? <SmallButton theme={theme} label={pick(locale, "恢复本页", "Reset page")} onPress={() => persist((current) => resetPage(current, active.page.id))} /> : null}
                </>
              ) : null}
            </View>
          </View>

          {mode === "edit" ? (
            <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
              {pick(locale, "编辑中：上移/下移、整行/半宽、隐藏或移除。修改会自动保存。", "Editing: move, resize, hide or remove. Changes save automatically.")}
            </Text>
          ) : null}

          {cards.length === 0 ? (
            <Panel theme={theme}>
              <Text style={{ fontSize: 11, color: theme.colors.foreground }}>{pick(locale, "这个页面还没有图表。", "This page has no charts yet.")}</Text>
              {canEdit ? <SmallButton theme={theme} label={pick(locale, "添加第一张图", "Add the first chart")} onPress={() => setMode("picker")} /> : null}
            </Panel>
          ) : (
            splitRows(cards, compact).map((row) => (
              <View key={row.map((item) => item.iid).join("|")} style={{ flexDirection: compact ? "column" : "row", gap: 10, alignItems: "stretch" }}>
                {row.map((instance) => {
                  const component = CARD_COMPONENTS[instance.card as CardId];
                  if (!component) return null;
                  const Component = component;
                  return (
                    <View key={instance.iid} style={{ flex: compact ? undefined : 1, width: compact ? "100%" : undefined, minWidth: 0 }}>
                      <CardFrame
                        theme={theme}
                        title={cardTitle(instance.card as CardId, locale)}
                        info={cardDescription(instance.card as CardId, locale)}
                        infoLabel={t("card.info")}
                        highlight={mode === "edit"}
                        fill={!compact}
                        trailing={mode === "edit" ? <CardEditControls theme={theme} locale={locale} page={configPage} instance={instance} persist={persist} /> : undefined}
                      >
                        <Component {...cardProps} />
                      </CardFrame>
                    </View>
                  );
                })}
              </View>
            ))
          )}

          {mode === "edit" && configPage.cards.some((instance) => instance.hidden) ? (
            <Panel theme={theme}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: theme.colors.foreground }}>{pick(locale, "已隐藏", "Hidden")}</Text>
              {configPage.cards.filter((instance) => instance.hidden).map((instance) => (
                <View key={instance.iid} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 11, color: theme.colors.foregroundMuted }}>{cardTitle(instance.card as CardId, locale)}</Text>
                  <SmallButton theme={theme} label={pick(locale, "显示", "Show")} onPress={() => persist((current) => toggleCardHidden(current, configPage.id, instance.iid))} />
                </View>
              ))}
            </Panel>
          ) : null}
        </>
      ) : (
        <Panel theme={theme}>
          <Text style={{ fontSize: 11, color: theme.colors.foreground }}>{pick(locale, "没有可见页面。", "No visible pages.")}</Text>
          {canEdit ? <SmallButton theme={theme} label={pick(locale, "恢复默认页面", "Restore default pages")} onPress={() => persist((current) => resetAll(current))} /> : null}
        </Panel>
      )}
    </View>
  );
}

function SmallButton({ theme, label, onPress, active = false, disabled = false, accessibilityLabel }: { theme: PluginScreenProps["theme"]; label: string; onPress: () => void; active?: boolean; disabled?: boolean; accessibilityLabel?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent : theme.colors.border,
        backgroundColor: active ? theme.colors.accent : theme.colors.surface1,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ fontSize: 10, color: active ? theme.colors.accentForeground : theme.colors.foreground }}>{label}</Text>
    </Pressable>
  );
}

function Panel({ theme, children }: { theme: PluginScreenProps["theme"]; children: ReactNode }) {
  return <View style={{ backgroundColor: theme.colors.surface1, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 10, padding: 12, gap: 8 }}>{children}</View>;
}

function CardEditControls({
  theme,
  locale,
  page,
  instance,
  persist,
}: {
  theme: PluginScreenProps["theme"];
  locale: "zh" | "en";
  page: DashboardPage;
  instance: DashboardCard;
  persist: Persist;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 3, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <SmallButton theme={theme} label="↑" accessibilityLabel={pick(locale, "上移卡片", "Move card up")} onPress={() => persist((current) => moveCard(current, page.id, instance.iid, -1))} />
      <SmallButton theme={theme} label="↓" accessibilityLabel={pick(locale, "下移卡片", "Move card down")} onPress={() => persist((current) => moveCard(current, page.id, instance.iid, 1))} />
      <SmallButton theme={theme} label={instance.span === "full" ? pick(locale, "半宽", "Half") : pick(locale, "整行", "Full")} onPress={() => persist((current) => toggleCardSpan(current, page.id, instance.iid))} />
      {page.builtin ? (
        <SmallButton theme={theme} label={pick(locale, "隐藏", "Hide")} onPress={() => persist((current) => toggleCardHidden(current, page.id, instance.iid))} />
      ) : (
        <SmallButton theme={theme} label={pick(locale, "移除", "Remove")} onPress={() => persist((current) => removeCard(current, page.id, instance.iid))} />
      )}
    </View>
  );
}

function PageManager({
  config,
  theme,
  locale,
  compact,
  activePageId,
  setActivePageId,
  persist,
  getConfig,
  onBack,
}: {
  config: DashboardConfig;
  theme: PluginScreenProps["theme"];
  locale: "zh" | "en";
  compact: boolean;
  activePageId: string | null;
  setActivePageId: (id: string | null) => void;
  persist: Persist;
  getConfig: () => DashboardConfig;
  onBack: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <SmallButton theme={theme} label={pick(locale, "← 返回", "← Back")} onPress={onBack} />
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "700", color: theme.colors.foreground }}>{pick(locale, "页面管理", "Pages")}</Text>
      </View>
      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
        {pick(locale, "预设页可改名、排序、隐藏，但不能删除；自定义页可以删除。恢复全部默认会保留自定义页。", "Preset pages can be renamed, reordered and hidden, not deleted. Custom pages can be deleted. Reset all keeps custom pages.")}
      </Text>
      <Panel theme={theme}>
        <Text style={{ fontSize: 11, fontWeight: "600", color: theme.colors.foreground }}>{pick(locale, "新建页面", "New page")}</Text>
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder={pick(locale, "页面名称（可选）", "Page name (optional)")}
          placeholderTextColor={theme.colors.foregroundMuted}
          maxLength={40}
          style={{ backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: 11, color: theme.colors.foreground }}
        />
        <View style={{ flexDirection: "row", gap: 5, flexWrap: "wrap" }}>
          <SmallButton
            theme={theme}
            disabled={config.pages.length >= DASHBOARD_MAX_PAGES}
            label={pick(locale, "空白页", "Blank page")}
            onPress={() => {
              const next = addPage(getConfig(), newName);
              const created = next.pages[next.pages.length - 1];
              persist(next);
              if (created) setActivePageId(created.id);
              setNewName("");
              onBack();
            }}
          />
          <SmallButton
            theme={theme}
            disabled={config.pages.length >= DASHBOARD_MAX_PAGES}
            label={pick(locale, "复制当前页", "Duplicate current")}
            onPress={() => {
              const next = addPage(getConfig(), newName || pick(locale, "我的看板", "My dashboard"), activePageId ?? undefined);
              const created = next.pages[next.pages.length - 1];
              persist(next);
              if (created) setActivePageId(created.id);
              setNewName("");
              onBack();
            }}
          />
        </View>
      </Panel>
      {config.pages.map((page, index) => (
        <PageRow
          key={page.id}
          page={page}
          index={index}
          total={config.pages.length}
          theme={theme}
          locale={locale}
          persist={persist}
          compact={compact}
          active={page.id === activePageId}
          onOpen={() => {
            setActivePageId(page.id);
            onBack();
          }}
        />
      ))}
      <View style={{ flexDirection: "row", gap: 6, justifyContent: "flex-end" }}>
        <SmallButton
          theme={theme}
          label={confirmReset ? pick(locale, "再点一次确认", "Tap again to confirm") : pick(locale, "恢复全部默认", "Reset all defaults")}
          onPress={() => {
            if (!confirmReset) {
              setConfirmReset(true);
              return;
            }
            persist((current) => resetAll(current));
            setConfirmReset(false);
          }}
        />
      </View>
    </View>
  );
}

function PageRow({
  page,
  index,
  total,
  theme,
  locale,
  persist,
  compact,
  active,
  onOpen,
}: {
  page: DashboardPage;
  index: number;
  total: number;
  theme: PluginScreenProps["theme"];
  locale: "zh" | "en";
  persist: Persist;
  compact: boolean;
  active: boolean;
  onOpen: () => void;
}) {
  const [name, setName] = useState(page.name || pageTitle(page, locale));
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setName(page.name || pageTitle(page, locale));
  }, [page.name, page.id, locale]);
  return (
    <Panel theme={theme}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Text style={{ fontSize: 9, color: active ? theme.colors.accent : theme.colors.foregroundMuted }}>{active ? "●" : "○"}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={() => {
            const next = name.trim();
            if (next !== (page.name ?? pageTitle(page, locale))) persist((current) => renamePage(current, page.id, next));
          }}
          maxLength={40}
          style={{ flex: 1, minWidth: compact ? 140 : 220, backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, fontSize: 11, color: theme.colors.foreground }}
        />
        <Text style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>{page.builtin ? pick(locale, "预设", "Preset") : pick(locale, "自定义", "Custom")}{page.hidden ? pick(locale, " · 已隐藏", " · hidden") : ""}</Text>
      </View>
      <Text style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>{pick(locale, `${page.cards.length} 张卡片`, `${page.cards.length} cards`)}</Text>
      <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
        <SmallButton theme={theme} label="↑" accessibilityLabel={pick(locale, "上移页面", "Move page up")} disabled={index === 0} onPress={() => persist((current) => movePage(current, page.id, -1))} />
        <SmallButton theme={theme} label="↓" accessibilityLabel={pick(locale, "下移页面", "Move page down")} disabled={index === total - 1} onPress={() => persist((current) => movePage(current, page.id, 1))} />
        <SmallButton theme={theme} label={page.hidden ? pick(locale, "显示", "Show") : pick(locale, "隐藏", "Hide")} onPress={() => persist((current) => togglePageHidden(current, page.id))} />
        <SmallButton theme={theme} label={pick(locale, "复制", "Duplicate")} onPress={() => persist((current) => addPage(current, `${name} ${pick(locale, "副本", "copy")}`, page.id))} />
        <SmallButton theme={theme} label={pick(locale, "打开", "Open")} onPress={() => { if (page.hidden) persist((current) => togglePageHidden(current, page.id)); onOpen(); }} />
        {page.builtin ? <SmallButton theme={theme} label={pick(locale, "重置", "Reset")} onPress={() => persist((current) => resetPage(current, page.id))} /> : null}
        {!page.builtin ? (
          <SmallButton
            theme={theme}
            label={confirmDelete ? pick(locale, "再点一次删除", "Tap again to delete") : pick(locale, "删除", "Delete")}
            onPress={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              persist((current) => deletePage(current, page.id));
              setConfirmDelete(false);
            }}
          />
        ) : null}
      </View>
    </Panel>
  );
}

function CardPicker({
  config,
  pageId,
  theme,
  locale,
  persist,
  onBack,
}: {
  config: DashboardConfig;
  pageId: string;
  theme: PluginScreenProps["theme"];
  locale: "zh" | "en";
  persist: Persist;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const page = config.pages.find((item) => item.id === pageId);
  if (!page) return null;
  const lower = query.trim().toLowerCase();
  const ids = (Object.keys(CARD_CATALOG) as CardId[])
    .filter((id) => isCardId(id))
    .filter((id) => {
      if (!lower) return true;
      return cardTitle(id, locale).toLowerCase().includes(lower) || cardDescription(id, locale).toLowerCase().includes(lower);
    })
    .sort((a, b) => {
      const left = CARD_CATALOG[a].category;
      const right = CARD_CATALOG[b].category;
      return PAGE_ORDER.indexOf(left) - PAGE_ORDER.indexOf(right) || cardTitle(a, locale).localeCompare(cardTitle(b, locale));
    });
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <SmallButton theme={theme} label={pick(locale, "← 返回", "← Back")} onPress={onBack} />
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "700", color: theme.colors.foreground }}>{pick(locale, "添加图表", "Add chart")}</Text>
        <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{page.cards.length}/{DASHBOARD_MAX_CARDS}</Text>
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={pick(locale, "搜索图表", "Search charts")}
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{ backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 11, color: theme.colors.foreground }}
      />
      {PAGE_ORDER.map((category) => {
        const items = ids.filter((id) => CARD_CATALOG[id].category === category);
        if (items.length === 0) return null;
        return (
          <View key={category} style={{ gap: 5 }}>
            <Text style={{ fontSize: 10, fontWeight: "600", color: theme.colors.foregroundMuted }}>{pageCopy(category as PageId).title[locale]}</Text>
            {items.map((id) => {
              const count = page.cards.filter((instance) => instance.card === id).length;
              return (
                <Panel key={id} theme={theme}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: theme.colors.foreground }}>{cardTitle(id, locale)}</Text>
                      <Text style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>{cardDescription(id, locale)}</Text>
                    </View>
                    {count > 0 ? <Text style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>×{count}</Text> : null}
                    <SmallButton theme={theme} label={count > 0 ? pick(locale, "再加一份", "Add another") : pick(locale, "添加", "Add")} disabled={page.cards.length >= DASHBOARD_MAX_CARDS} onPress={() => persist((current) => addCard(current, page.id, id))} />
                  </View>
                </Panel>
              );
            })}
          </View>
        );
      })}
      {ids.length === 0 ? <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>{pick(locale, "没有匹配的图表。", "No matching charts.")}</Text> : null}
    </View>
  );
}