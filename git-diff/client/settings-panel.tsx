import type { PluginTheme } from "@getpaseo/plugin";
import { createElement, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { PanelSettings } from "../shared/settings";
import { MAX_CACHED_TABS } from "../shared/tab-cache";
import { pluginVersion } from "../shared/version";
import { InputField, setWebTitle, ToolButton } from "./controls";
import { Icon } from "./icons";
import { SettingsSelect } from "./settings-select";
import { codeFont, panelTokens } from "./theme";

const settingsTabs = [
  { id: "appearance", label: "外观", icon: "sidebar" },
  { id: "code", label: "代码", icon: "code" },
  { id: "comparison", label: "比较", icon: "split" },
  { id: "behavior", label: "行为", icon: "refresh" },
] as const;
type SettingsTab = (typeof settingsTabs)[number]["id"];

export function SettingsPanel({
  theme,
  values,
  update,
  saving,
  error,
  retry,
  reset,
  onClose,
}: {
  theme: PluginTheme;
  values: PanelSettings;
  update(patch: Partial<PanelSettings>): void;
  saving: boolean;
  error: string | null;
  retry(): void;
  reset(): void;
  onClose(): void;
}) {
  const c = panelTokens(theme);
  const [active, setActive] = useState<SettingsTab>("appearance");
  const tabRefs = useRef(new Map<SettingsTab, View>());
  const labelStyle = { color: c.foreground, fontSize: 12, lineHeight: 18 };
  const hintStyle = { color: c.foregroundMuted, fontSize: 11, lineHeight: 18 };
  function toggle(key: keyof PanelSettings, label: string, hint?: string) {
    const checked = values[key] === true;
    return (
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityState={{ checked }}
        {...(Platform.OS === "web" ? { "aria-checked": checked } : {})}
        onPress={() => update({ [key]: !checked })}
        style={{
          minHeight: 46,
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
          paddingVertical: 8,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={labelStyle}>{label}</Text>
          {hint ? <Text style={hintStyle}>{hint}</Text> : null}
        </View>
        <View
          style={{
            width: 29,
            height: 17,
            borderRadius: 9,
            backgroundColor: checked ? c.accent : c.surface2,
            padding: 3,
            alignItems: checked ? "flex-end" : "flex-start",
          }}
        >
          <View
            style={{
              width: 11,
              height: 11,
              borderRadius: 6,
              backgroundColor: checked ? c.accentForeground : c.foregroundMuted,
            }}
          />
        </View>
      </Pressable>
    );
  }
  function select<K extends keyof PanelSettings>(
    key: K,
    label: string,
    options: { value: PanelSettings[K]; label: string }[],
    disabled = false,
  ) {
    return (
      <View style={{ gap: 7, paddingVertical: 9, flex: 1, minWidth: 0 }}>
        <Text style={[labelStyle, disabled && { color: c.foregroundMuted }]}>{label}</Text>
        <SettingsSelect
          theme={theme}
          label={label}
          value={String(values[key])}
          disabled={disabled}
          options={options.map((option) => ({ value: String(option.value), label: option.label }))}
          onChange={(value) => {
            const option = options.find((option) => String(option.value) === value);
            if (option) update({ [key]: option.value });
          }}
        />
      </View>
    );
  }
  function segmented<K extends keyof PanelSettings>(
    key: K,
    label: string,
    options: { value: PanelSettings[K]; label: string }[],
  ) {
    return (
      <View style={{ gap: 7, paddingVertical: 9 }}>
        <Text style={labelStyle}>{label}</Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={label}
          style={{
            flexDirection: "row",
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          {options.map((option, index) => {
            const selected = values[key] === option.value;
            return (
              <Pressable
                key={String(option.value)}
                accessibilityRole="radio"
                accessibilityLabel={`${label}：${option.label}`}
                accessibilityState={{ checked: selected }}
                {...(Platform.OS === "web" ? { "aria-checked": selected } : {})}
                onPress={() => update({ [key]: option.value })}
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 32,
                  paddingHorizontal: 7,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: selected ? c.selection : c.surface0,
                  borderRightWidth: index < options.length - 1 ? 1 : 0,
                  borderRightColor: c.border,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    color: selected ? c.foreground : c.foregroundMuted,
                    fontSize: 12,
                    fontWeight: selected ? "500" : "400",
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }
  function section(title: string, first = false) {
    return (
      <Text
        accessibilityRole="header"
        style={{
          color: c.foregroundMuted,
          fontSize: 11,
          fontWeight: "600",
          marginTop: first ? 4 : 22,
          marginBottom: 5,
        }}
      >
        {title}
      </Text>
    );
  }
  function switchTab(index: number) {
    const tab = settingsTabs[(index + settingsTabs.length) % settingsTabs.length];
    setActive(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  }
  const activeTab = settingsTabs.find((tab) => tab.id === active) ?? settingsTabs[0];
  return (
    <Modal transparent animationType="none" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          justifyContent: "flex-end",
          backgroundColor: "#00000044",
        }}
      >
        <Pressable accessibilityLabel="关闭设置背景" onPress={onClose} style={{ flex: 1 }} />
        <View
          testID="git-settings-panel"
          {...(Platform.OS === "web" ? { dataSet: { pmono: "true" } } : {})}
          accessibilityViewIsModal
          style={{
            width: 380,
            maxWidth: "100%",
            backgroundColor: c.surface1,
            borderLeftWidth: 1,
            borderLeftColor: c.border,
          }}
        >
          {Platform.OS === "web"
            ? createElement(
                "style",
                null,
                `[data-testid="git-settings-panel"] :is([role="tab"],[role="radio"],[role="switch"]):focus-visible{outline:1px solid ${c.accent};outline-offset:-2px}`,
              )
            : null}
          <View
            style={{
              minHeight: 46,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 16,
            }}
          >
            <Icon name="settings" color={c.foregroundMuted} />
            <Text
              accessibilityRole="header"
              style={{ ...labelStyle, fontSize: 13, fontWeight: "600" }}
            >
              Git 设置
            </Text>
            <Text style={{ ...hintStyle, flex: 1 }}>此主机</Text>
            <ToolButton theme={theme} icon="close" label="关闭设置" onPress={onClose} />
          </View>
          <View
            accessibilityRole="tablist"
            accessibilityLabel="设置分类"
            style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.border }}
          >
            {settingsTabs.map((tab, index) => {
              const selected = active === tab.id;
              return (
                <Pressable
                  key={tab.id}
                  nativeID={`git-settings-tab-${tab.id}`}
                  ref={(node) => {
                    if (node) tabRefs.current.set(tab.id, node);
                    else tabRefs.current.delete(tab.id);
                  }}
                  accessibilityRole="tab"
                  accessibilityLabel={tab.label}
                  accessibilityState={{ selected }}
                  {...(Platform.OS === "web"
                    ? {
                        "aria-selected": selected,
                        "aria-controls": `git-settings-page-${tab.id}`,
                        tabIndex: selected ? 0 : -1,
                        onKeyDown: (event: { key: string; preventDefault(): void }) => {
                          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                            event.preventDefault();
                            switchTab(
                              event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? settingsTabs.length - 1
                                  : index + (event.key === "ArrowLeft" ? -1 : 1),
                            );
                          }
                        },
                      }
                    : {})}
                  onPress={() => {
                    setActive(tab.id);
                    if (Platform.OS === "web") tabRefs.current.get(tab.id)?.focus();
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 40,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    borderBottomWidth: 2,
                    borderBottomColor: selected ? c.accent : "transparent",
                    backgroundColor: selected ? c.surface0 : "transparent",
                  }}
                >
                  <Icon
                    name={tab.icon}
                    size={14}
                    color={selected ? c.foreground : c.foregroundMuted}
                  />
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: selected ? "600" : "400",
                      color: selected ? c.foreground : c.foregroundMuted,
                    }}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <ScrollView
            key={active}
            testID="git-settings-content"
            nativeID={`git-settings-page-${active}`}
            {...(Platform.OS === "web"
              ? {
                  role: "tabpanel",
                  "aria-label": activeTab.label,
                  "aria-labelledby": `git-settings-tab-${active}`,
                }
              : {})}
            style={{ flex: 1, minHeight: 0 }}
            contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24 }}
          >
            {active === "appearance" ? (
              <>
                {section("文件浏览", true)}
                {toggle("sidebarVisible", "显示文件侧栏")}
                {segmented("tree", "文件排列", [
                  { value: false, label: "列表" },
                  { value: true, label: "目录树" },
                ])}
                {segmented("scrollbar", "滚动条", [
                  { value: "thin", label: "纤细" },
                  { value: "auto", label: "系统" },
                ])}
                <Text style={{ ...hintStyle, marginTop: 14 }}>
                  拖动侧栏边缘或左右对比中线可调整宽度，松手后自动记住。
                </Text>
              </>
            ) : active === "code" ? (
              <>
                {section("字体", true)}
                {select("fontFamily", "代码字体", [
                  { value: "paseo", label: "Paseo 默认" },
                  { value: "vscode", label: "VS Code" },
                  { value: "jetbrains", label: "JetBrains Mono" },
                  { value: "custom", label: "自定义" },
                ])}
                {values.fontFamily === "custom" ? (
                  <InputField
                    theme={theme}
                    accessibilityLabel="自定义代码字体"
                    placeholder="例如：SF Mono, Menlo"
                    placeholderTextColor={c.foregroundMuted}
                    value={values.customFontFamily}
                    maxLength={160}
                    onChangeText={(value) =>
                      update({
                        customFontFamily: value.replace(/[^\w\s,'".\-\u0080-\uFFFF]/gu, ""),
                      })
                    }
                    autoCapitalize="none"
                    autoCorrect={false}
                    containerStyle={{ marginBottom: 4 }}
                  />
                ) : null}
                <View style={{ flexDirection: "row", gap: 12 }}>
                  {select(
                    "fontSize",
                    "字号",
                    Array.from({ length: 11 }, (_, index) => ({
                      value: index + 10,
                      label: `${index + 10} px`,
                    })),
                  )}
                  {select("fontWeight", "字重", [
                    { value: "400", label: "常规 · 400" },
                    { value: "500", label: "中等 · 500" },
                    { value: "600", label: "加粗 · 600" },
                  ])}
                </View>
                <View
                  testID="settings-font-preview"
                  {...(Platform.OS === "web"
                    ? { dataSet: { gitCode: "true", pmono: "true" } }
                    : {})}
                  style={{
                    minHeight: 80,
                    padding: 12,
                    marginTop: 3,
                    backgroundColor: c.surface0,
                    borderWidth: 1,
                    borderColor: c.border,
                    borderRadius: 3,
                  }}
                >
                  <Text
                    style={{
                      color: c.foreground,
                      fontFamily: codeFont(values),
                      fontWeight: values.fontWeight,
                      fontSize: values.fontSize,
                      lineHeight: values.fontSize + 7,
                    }}
                  >
                    {"const message = 'Hello, Paseo';\n// 字体预览 0123456789"}
                  </Text>
                </View>
                <Text style={{ ...hintStyle, marginTop: 6 }}>
                  使用已安装字体；不可用时回退到系统等宽字体。
                </Text>
                {section("代码显示")}
                {toggle("syntaxHighlight", "语法着色")}
                {toggle("lineNumbers", "显示行号")}
                {toggle("wrap", "自动换行")}
                {select(
                  "tabSize",
                  "Tab 宽度",
                  [2, 4, 8].map((value) => ({ value: value as 2 | 4 | 8, label: `${value} 空格` })),
                )}
              </>
            ) : active === "comparison" ? (
              <>
                {section("差异视图", true)}
                {segmented("comparison", "比较范围", [
                  { value: "head", label: "全部" },
                  { value: "staged", label: "已暂存" },
                  { value: "unstaged", label: "未暂存" },
                ])}
                {segmented("mode", "差异布局", [
                  { value: "split", label: "左右" },
                  { value: "unified", label: "统一" },
                ])}
                {select("context", "上下文", [
                  { value: 3, label: "3 行" },
                  { value: 20, label: "20 行" },
                  { value: 1000000, label: "全文" },
                ])}
                {toggle("ignoreWhitespace", "忽略空白变化")}
              </>
            ) : (
              <>
                {section("标签缓存", true)}
                {select(
                  "tabCacheSize",
                  "缓存标签数量",
                  Array.from({ length: MAX_CACHED_TABS }, (_, index) => ({
                    value: index + 1,
                    label: `${index + 1} 个${index === 4 ? " · 默认" : ""}`,
                  })),
                )}
                <Text style={hintStyle}>
                  保留最近访问标签的内容和滚动位置；大文件或图表较多时会提前释放较早的缓存。
                </Text>
                {section("文件预览")}
                {toggle("previewDefault", "优先打开预览", "适用于 Markdown、HTML 和图片。")}
                <Text style={hintStyle}>
                  Markdown 支持 Mermaid。在文件工具栏随时切换预览与差异。
                </Text>
                {section("Git 状态")}
                {toggle("automatic", "自动刷新 Git 状态")}
                {select(
                  "refreshInterval",
                  "刷新间隔",
                  [2000, 5000, 10000, 30000].map((value) => ({
                    value: value as 2000 | 5000 | 10000 | 30000,
                    label: `${value / 1000} 秒`,
                  })),
                  !values.automatic,
                )}
                {!values.automatic ? (
                  <Text style={hintStyle}>已暂停自动刷新，仍可在文件侧栏手动刷新。</Text>
                ) : null}
              </>
            )}
          </ScrollView>
          {error ? (
            <View
              accessibilityRole="alert"
              style={{
                paddingHorizontal: 16,
                paddingVertical: 10,
                gap: 5,
                borderTopWidth: 1,
                borderTopColor: c.border,
              }}
            >
              <Text style={{ color: c.statusDanger, fontSize: 11, lineHeight: 17 }}>{error}</Text>
              <ToolButton
                theme={theme}
                label="重试保存设置"
                icon="refresh"
                text="重试"
                onPress={retry}
              />
            </View>
          ) : null}
          <View
            style={{
              minHeight: 42,
              paddingHorizontal: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              borderTopWidth: 1,
              borderTopColor: c.border,
            }}
          >
            <Icon
              name={saving ? "refresh" : error ? "warning" : "check"}
              size={12}
              color={error ? c.statusDanger : c.foregroundMuted}
            />
            <Text
              ref={(node) => setWebTitle(node, "设置自动保存到当前 Paseo 主机")}
              accessibilityLiveRegion="polite"
              style={{ color: c.foregroundMuted, fontSize: 11, flex: 1 }}
            >
              {saving ? "正在保存…" : error ? "尚未保存" : "已保存"}
            </Text>
            <Text
              testID="git-plugin-version"
              ref={(node) => setWebTitle(node, `Git Diff with Submodules v${pluginVersion}`)}
              accessibilityLabel={`插件版本 ${pluginVersion}`}
              selectable
              style={{ color: c.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}
            >
              v{pluginVersion}
            </Text>
            <ToolButton theme={theme} label="恢复默认设置" text="恢复默认" onPress={reset} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
