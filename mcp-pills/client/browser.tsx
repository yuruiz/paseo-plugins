import { type PluginHostProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { type ServerEntry, type InterfaceEntry } from "../shared/contracts";
import { filterServers, filterInterfaces } from "./filter";
import { useServers, useInspection } from "./query";

type Theme = PluginHostProps["theme"];
const LABELS = {
  all: "全部",
  tool: "Tools",
  resource: "Resources",
  template: "Templates",
  prompt: "Prompts",
} as const;
const SCOPES = { user: "用户配置", project: "项目配置", session: "会话配置" };

function Action({
  title,
  onPress,
  theme,
  disabled = false,
}: {
  title: string;
  onPress(): void;
  theme: Theme;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 9,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: theme.colors.accent, fontSize: 13 }}>{title}</Text>
    </Pressable>
  );
}
function Note({
  children,
  theme,
  danger = false,
}: {
  children: string;
  theme: Theme;
  danger?: boolean;
}) {
  return (
    <Text
      selectable
      style={{
        color: danger ? theme.colors.statusDanger : theme.colors.foregroundMuted,
        fontSize: 12,
        lineHeight: 17,
      }}
    >
      {children}
    </Text>
  );
}
function Search({
  value,
  onChange,
  placeholder,
  theme,
}: {
  value: string;
  onChange(value: string): void;
  placeholder: string;
  theme: Theme;
}) {
  return (
    <TextInput
      accessibilityLabel={placeholder}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.foregroundMuted}
      value={value}
      onChangeText={onChange}
      autoCapitalize="none"
      autoCorrect={false}
      style={{
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 6,
        paddingVertical: 7,
        paddingHorizontal: 9,
        fontSize: 12,
      }}
    />
  );
}
function Definition({ entry, theme }: { entry: InterfaceEntry; theme: Theme }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View
      style={{
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? "收起" : "展开"} ${entry.name}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ padding: 8, gap: 4 }}
      >
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Icon
            name={expanded ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={theme.colors.foregroundMuted}
          />
          <Text
            selectable
            style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 }}
          >
            {entry.name}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            {LABELS[entry.kind]}
          </Text>
        </View>
        {entry.configuredDisabled ? (
          <Note theme={theme}>配置中的工具过滤规则已禁用此工具</Note>
        ) : null}
        {entry.description ? (
          <Text
            numberOfLines={expanded ? undefined : 1}
            style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}
          >
            {entry.description}
          </Text>
        ) : null}
      </Pressable>
      {expanded ? (
        <View style={{ padding: 8, paddingTop: 0, gap: 6 }}>
          <Note theme={theme}>接口完整定义 · 参数、schema 与能力注解</Note>
          <Text
            selectable
            style={{
              color: theme.colors.foreground,
              fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
              fontSize: 11,
              lineHeight: 17,
              backgroundColor: theme.colors.surface1,
              padding: 10,
              borderRadius: 6,
            }}
          >
            {JSON.stringify(entry.details, null, 2)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function ServerDetails({
  server,
  agentId,
  theme,
}: {
  server: ServerEntry;
  agentId: string;
  theme: Theme;
}) {
  const query = useInspection(agentId, server);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<InterfaceEntry["kind"] | "all">("all");
  const [more, setMore] = useState(false);
  const [limit, setLimit] = useState(40);
  const data = query.data;
  const entries = filterInterfaces(data?.entries ?? [], search, kind);
  return (
    <View style={{ gap: 8 }}>
      <Note
        theme={theme}
      >{`${SCOPES[server.scope]} · ${server.transport.toUpperCase()}${server.endpoint ? ` · ${server.endpoint}` : ""}`}</Note>
      <Note theme={theme}>{server.source}</Note>
      <Note theme={theme}>{server.disabled ? "配置已禁用" : "已配置 · agent 加载状态未知"}</Note>
      {server.issue ? (
        <Note theme={theme} danger>
          {server.issue}
        </Note>
      ) : null}
      {server.enabledTools ? (
        <Note
          theme={theme}
        >{`工具允许列表：${server.enabledTools.join("、") || "空（全部禁用）"}`}</Note>
      ) : null}
      {server.disabledTools.length ? (
        <Note theme={theme}>{`工具禁用列表：${server.disabledTools.join("、")}`}</Note>
      ) : null}
      <Action
        title={
          query.isFetching ? "正在连接与读取…" : data ? "重新连接并刷新接口" : "连接并浏览接口"
        }
        onPress={() => {
          void query.refetch();
        }}
        theme={theme}
        disabled={query.isFetching || server.disabled || Boolean(server.issue)}
      />
      <Note theme={theme}>
        {server.transport === "stdio"
          ? "点击后会启动配置中的本地命令，仅查询接口，结束后关闭进程。"
          : "点击后由 daemon 连接该服务，仅查询接口定义。"}
      </Note>
      {query.isError ? (
        <Note theme={theme} danger>
          请求失败，配置可能已变化或主机已断开。请返回并刷新服务列表后重试。
        </Note>
      ) : null}
      {data ? (
        <>
          <Text
            style={{
              color:
                data.status === "connected"
                  ? theme.colors.statusSuccess
                  : theme.colors.statusWarning,
              fontSize: 13,
            }}
          >
            {data.status === "connected"
              ? "连接成功"
              : data.status === "auth-required"
                ? "需要认证"
                : "连接失败"}
          </Text>
          <Note theme={theme}>{data.message}</Note>
          <Note theme={theme}>{`上次查询：${new Date(data.checkedAt).toLocaleString()}`}</Note>
          {data.warnings.map((warning, index) => (
            <Note key={index} theme={theme}>
              {warning}
            </Note>
          ))}
          {data.status === "connected" ? (
            <>
              <Action
                title={more ? "收起服务能力" : "展开服务能力与说明"}
                onPress={() => setMore(!more)}
                theme={theme}
              />
              {more ? (
                <View style={{ gap: 8 }}>
                  <Note
                    theme={theme}
                  >{`${data.serverName ?? server.name} ${data.serverVersion ?? ""}`}</Note>
                  {data.instructions ? <Note theme={theme}>{data.instructions}</Note> : null}
                  <Text selectable style={{ color: theme.colors.foreground, fontSize: 12 }}>
                    {JSON.stringify(data.capabilities, null, 2)}
                  </Text>
                </View>
              ) : null}
              <Search
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setLimit(40);
                }}
                placeholder="搜索接口、说明或参数"
                theme={theme}
              />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: kind === value }}
                    onPress={() => {
                      setKind(value);
                      setLimit(40);
                    }}
                    style={{
                      padding: 8,
                      borderRadius: 6,
                      backgroundColor: kind === value ? theme.colors.accent : theme.colors.surface2,
                    }}
                  >
                    <Text
                      style={{
                        color:
                          kind === value
                            ? theme.colors.accentForeground
                            : theme.colors.foregroundMuted,
                        fontSize: 12,
                      }}
                    >
                      {LABELS[value]}{" "}
                      {value === "all"
                        ? data.entries.length
                        : data.entries.filter((entry) => entry.kind === value).length}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {!entries.length ? (
                <Note theme={theme}>
                  {data.entries.length
                    ? "没有匹配的接口。"
                    : data.warnings.length
                      ? "未能读取到接口，请查看上方提示。"
                      : "服务未声明可浏览的工具、资源或提示词。"}
                </Note>
              ) : null}
              {entries.slice(0, limit).map((entry, index) => (
                <Definition
                  key={`${entry.kind}:${entry.name}:${index}`}
                  entry={entry}
                  theme={theme}
                />
              ))}
              {entries.length > limit ? (
                <Action
                  theme={theme}
                  title={`显示更多（剩余 ${entries.length - limit}）`}
                  onPress={() => setLimit(limit + 40)}
                />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function ServerStatus({
  agentId,
  server,
  theme,
}: {
  agentId: string;
  server: ServerEntry;
  theme: Theme;
}) {
  const query = useInspection(agentId, server);
  let label = "未查询";
  let color = theme.colors.foregroundMuted;
  if (server.disabled) label = "已禁用";
  else if (server.issue) {
    label = "需检查";
    color = theme.colors.statusWarning;
  } else if (query.isFetching) label = "查询中";
  else if (query.isError || query.data?.status === "error") {
    label = "查询失败";
    color = theme.colors.statusDanger;
  } else if (query.data?.status === "auth-required") {
    label = "需认证";
    color = theme.colors.statusWarning;
  } else if (query.data?.status === "connected") {
    label = query.data.warnings.length ? "部分读取" : "已读取";
    color = query.data.warnings.length ? theme.colors.statusWarning : theme.colors.statusSuccess;
  }
  const checkedAt = query.data
    ? `，上次查询 ${new Date(query.data.checkedAt).toLocaleString()}`
    : "";
  return (
    <Text accessibilityLabel={`${label}${checkedAt}`} style={{ color, fontSize: 11 }}>
      {label}
    </Text>
  );
}

function IconAction({
  label,
  icon,
  onPress,
  theme,
  disabled = false,
  compact,
}: {
  label: string;
  icon: "ArrowLeft" | "RefreshCw" | "Maximize2";
  onPress(): void;
  theme: Theme;
  disabled?: boolean;
  compact: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={{
        width: compact ? 36 : 28,
        height: compact ? 36 : 28,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon name={icon} size={15} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

export function McpBrowser({
  agentId,
  theme,
  frame,
  compact = false,
  onOpenTab,
}: {
  agentId: string;
  theme: Theme;
  frame: "panel" | "popover";
  compact?: boolean;
  onOpenTab?: () => void;
}) {
  const query = useServers(agentId);
  const [selection, setSelection] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showSources, setShowSources] = useState(false);
  const server = query.data?.servers.find((item) => item.id === selection);
  const servers = filterServers(query.data?.servers ?? [], search);
  const body = (
    <View style={{ gap: 8, padding: frame === "panel" ? 12 : 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {server ? (
          <IconAction
            label="返回服务列表"
            icon="ArrowLeft"
            theme={theme}
            compact={compact}
            onPress={() => setSelection(null)}
          />
        ) : null}
        <Text
          numberOfLines={1}
          style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 14, flex: 1 }}
        >
          {server ? server.name : `MCP 配置${query.data ? ` · ${query.data.servers.length}` : ""}`}
        </Text>
        <IconAction
          label={query.isFetching ? "读取配置中" : "刷新配置"}
          icon="RefreshCw"
          theme={theme}
          compact={compact}
          disabled={query.isFetching}
          onPress={() => {
            void query.refetch();
          }}
        />
        {onOpenTab ? (
          <IconAction
            label="在标签页中打开 MCP 浏览器"
            icon="Maximize2"
            theme={theme}
            compact={compact}
            onPress={onOpenTab}
          />
        ) : null}
      </View>
      {server ? (
        <ServerDetails
          key={`${agentId}:${server.id}:${server.revision}`}
          server={server}
          agentId={agentId}
          theme={theme}
        />
      ) : (
        <>
          <Search value={search} onChange={setSearch} placeholder="搜索 MCP…" theme={theme} />
          {query.isError ? (
            <Note theme={theme} danger>
              读取配置失败，请确认主机在线后刷新重试。
            </Note>
          ) : null}
          {query.isPending ? <Note theme={theme}>正在读取 MCP 配置…</Note> : null}
          {query.data && !servers.length ? (
            <Note theme={theme}>
              {query.data.servers.length
                ? "没有匹配的 MCP。"
                : "未发现配置，不代表 agent 没有可用 MCP。"}
            </Note>
          ) : null}
          <View>
            {servers.map((item, index) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`浏览 ${item.name}`}
                onPress={() => setSelection(item.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: compact ? 10 : 8,
                  paddingHorizontal: 2,
                  gap: 8,
                  borderBottomWidth: index < servers.length - 1 ? 1 : 0,
                  borderBottomColor: theme.colors.border,
                }}
              >
                <Icon
                  name="Plug"
                  size={15}
                  color={item.disabled ? theme.colors.foregroundMuted : theme.colors.accent}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={1}
                    style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "500" }}
                  >
                    {item.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 15 }}
                  >
                    {`${SCOPES[item.scope]} · ${item.transport.toUpperCase()}`}
                  </Text>
                </View>
                <ServerStatus agentId={agentId} server={item} theme={theme} />
                <Icon name="ChevronRight" size={13} color={theme.colors.foregroundMuted} />
              </Pressable>
            ))}
          </View>
          {query.data ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="发现范围与限制"
                accessibilityState={{ expanded: showSources }}
                onPress={() => setShowSources(!showSources)}
                hitSlop={4}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 }}
              >
                <Icon
                  name={showSources ? "ChevronDown" : "ChevronRight"}
                  size={12}
                  color={theme.colors.foregroundMuted}
                />
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                  配置清单 · agent 加载状态未知
                </Text>
              </Pressable>
              {showSources ? (
                <View style={{ gap: 6 }}>
                  <Note theme={theme}>
                    这里展示配置与最近一次接口查询结果，查询结束后连接会关闭。当前 agent
                    的实际加载状态、权限和运行时注入的 MCP 尚无法确认。
                  </Note>
                  <Note
                    theme={theme}
                  >{`Provider：${query.data.provider}。同名服务按配置层级合并或覆盖；认证值与启动参数不会发送到客户端。`}</Note>
                  {query.data.warnings.map((warning, index) => (
                    <Note theme={theme} key={index}>
                      {warning}
                    </Note>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </View>
  );
  return frame === "panel" ? (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      {body}
    </ScrollView>
  ) : (
    body
  );
}
