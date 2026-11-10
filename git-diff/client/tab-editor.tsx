import type { PluginTheme } from "@getpaseo/plugin";
import { useCallback, useEffect } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import type { CompareResult } from "../shared/compare-contracts";
import type { Comparison } from "../shared/contracts";
import { diffWeight } from "../shared/diff-cache";
import type { PanelSettings } from "../shared/settings";
import type { TabStats } from "../shared/tab-cache";
import { ToolButton } from "./controls";
import { type DiffLayout, DiffViewer } from "./diff-viewer";
import { FilePreview } from "./file-preview";
import { Icon } from "./icons";
import type { PreviewKind } from "./preview-model";
import { codeFont, panelTokens } from "./theme";
import { useFileDiff } from "./use-changes";

export function TabEditor({
  tabKey,
  directory,
  repositoryId,
  path,
  version,
  comparison,
  revision,
  linked,
  preview,
  kind,
  settings,
  theme,
  mode,
  navigation,
  previewNavigation,
  onNavigate,
  onStats,
  onSplitRatioChange,
  onSplitRatioCommit,
  from,
  to,
}: {
  tabKey: string;
  directory: string;
  repositoryId: string;
  path: string;
  version: string;
  comparison: Comparison;
  revision?: Pick<CompareResult, "baseOid" | "targetOid">;
  linked: boolean;
  preview: boolean;
  kind: PreviewKind | null;
  settings: PanelSettings;
  theme: PluginTheme;
  mode: DiffLayout;
  navigation: { index: number; request: number };
  previewNavigation?: { fragment: string; request: number };
  onNavigate(href: string): void;
  onStats(key: string, stats: TabStats): void;
  onSplitRatioChange(ratio: number): void;
  onSplitRatioCommit(): void;
  from: string;
  to: string;
}) {
  const c = panelTokens(theme);
  const patch = useFileDiff(
    preview
      ? null
      : {
          directory,
          repositoryId,
          path,
          version,
          comparison,
          revision,
          context: settings.context,
          ignoreWhitespace: settings.ignoreWhitespace,
        },
  );
  const view = JSON.stringify([version, comparison, settings.context, settings.ignoreWhitespace]);
  const loadFullContext = useCallback(async () => {
    const full = await patch.loadFullContext();
    onStats(tabKey, {
      hunks: patch.data?.hunks.length ?? 0,
      bytes: (diffWeight(full) + (patch.data ? diffWeight(patch.data) : 0)) * 3,
      view,
    });
    return full;
  }, [patch.loadFullContext, patch.data, onStats, tabKey, view]);
  useEffect(() => {
    if (!preview && patch.data)
      // Reserve room for derived rows, syntax state and mounted visible lines too.
      onStats(tabKey, { hunks: patch.data.hunks.length, bytes: diffWeight(patch.data) * 3, view });
  }, [preview, patch.data, onStats, tabKey, view]);
  const previewCost = useCallback(
    (bytes: number) => onStats(tabKey, { hunks: 0, bytes }),
    [onStats, tabKey],
  );
  if (preview && kind)
    return (
      <FilePreview
        directory={directory}
        repositoryId={repositoryId}
        path={path}
        version={version}
        comparison={linked ? "head" : comparison}
        scope={linked ? "workspace" : "changes"}
        kind={kind}
        theme={theme}
        fontSize={settings.fontSize}
        fontFamily={codeFont(settings)}
        fontWeight={settings.fontWeight}
        navigation={previewNavigation}
        onNavigate={onNavigate}
        onCost={previewCost}
      />
    );
  if (patch.error)
    return (
      <View
        accessibilityRole="alert"
        style={{ flex: 1, padding: 24, gap: 12, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="warning" color={c.statusDanger} size={26} />
        <Text selectable style={{ color: c.foregroundMuted, fontSize: 12 }}>
          {patch.error}
        </Text>
        <ToolButton
          theme={theme}
          label="重试读取差异"
          text="重试"
          icon="refresh"
          onPress={patch.retry}
        />
      </View>
    );
  if (patch.data)
    return (
      <DiffViewer
        key={comparison}
        diff={patch.data}
        loadFullContext={loadFullContext}
        completeContext={settings.context === 1000000}
        theme={theme}
        mode={mode}
        wrap={settings.wrap}
        syntaxHighlight={settings.syntaxHighlight}
        fontSize={settings.fontSize}
        fontFamily={codeFont(settings)}
        fontWeight={settings.fontWeight}
        splitRatio={settings.splitRatio}
        onSplitRatioChange={onSplitRatioChange}
        onSplitRatioCommit={onSplitRatioCommit}
        tabSize={settings.tabSize}
        lineNumbers={settings.lineNumbers}
        navigation={navigation}
        from={from}
        to={to}
      />
    );
  return (
    <View style={{ flex: 1, padding: 24, gap: 12, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="small" color={c.accent} />
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>正在读取文件差异…</Text>
    </View>
  );
}
