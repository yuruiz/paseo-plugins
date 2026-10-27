import type {
  PluginButtonContentProps,
  PluginClientOpenPanelOptions,
  PluginHostProps,
} from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useReducer } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Command } from "../shared/commands";
import { useCommandCatalog } from "./catalog";
import { CommandDetail } from "./panel";
import { createStyles, type Styles } from "./styles";

type OpenTab = (target: PluginClientOpenPanelOptions) => void;
interface PopoverState {
  search: string;
  selectedId: string | null;
}
type PopoverAction = { type: "search"; value: string } | { type: "select"; id: string | null };
function reducer(state: PopoverState, action: PopoverAction): PopoverState {
  if (action.type === "search") return { ...state, search: action.value };
  return { ...state, selectedId: action.id };
}
const EMPTY_COMMANDS: Command[] = [];
const GROUPS: Command["scope"][] = ["project", "global", "session"];

// The host owns anchoring, padding, scrolling and compact sheet presentation.
export function createCommandsPopover(openTab: OpenTab) {
  return function CommandsPopover(props: PluginButtonContentProps) {
    if (props.context !== "agent") return null;
    return <PopoverBody key={props.agentId} {...props} openTab={openTab} />;
  };
}

interface RowProps {
  command: Command;
  styles: Styles;
  select(id: string): void;
}
function CommandRow({ command, styles, select }: RowProps) {
  const onPress = useCallback(() => select(command.id), [select, command.id]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${command.name}, ${command.scope}`}
      onPress={onPress}
      style={popoverStyles.row}
    >
      <Text style={styles.text}>{command.name}</Text>
      <Text numberOfLines={2} style={styles.muted}>
        {command.description || command.path || "Session command"}
      </Text>
    </Pressable>
  );
}

interface GroupProps {
  scope: Command["scope"];
  commands: Command[];
  styles: Styles;
  select(id: string): void;
}
function CommandGroup({ scope, commands, styles, select }: GroupProps) {
  const entries = commands.filter((command) => command.scope === scope);
  if (entries.length === 0) return null;
  return (
    <View style={popoverStyles.group}>
      <Text style={styles.muted}>{scope.toUpperCase()}</Text>
      {entries.map((command) => (
        <CommandRow key={command.id} command={command} styles={styles} select={select} />
      ))}
    </View>
  );
}

interface BodyProps extends PluginHostProps {
  agentId: string;
  workspaceId: string;
  close(): void;
  openTab: OpenTab;
}
function PopoverBody({ theme, layout, agentId, workspaceId, close, openTab }: BodyProps) {
  const styles = useMemo(() => createStyles(theme, true, "popover"), [theme]);
  const linkStyle = useMemo(() => ({ color: theme.colors.accent, fontSize: 13 }), [theme]);
  const { agent, query } = useCommandCatalog(agentId);
  const [state, dispatch] = useReducer(reducer, { search: "", selectedId: null });
  const commands = query.data?.commands ?? EMPTY_COMMANDS;
  const selected = commands.find((command) => command.id === state.selectedId);
  const needle = state.search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      commands.filter((command) =>
        `${command.name} ${command.description} ${command.path ?? ""}`
          .toLowerCase()
          .includes(needle),
      ),
    [commands, needle],
  );
  const search = useCallback((value: string) => dispatch({ type: "search", value }), []);
  const select = useCallback((id: string) => dispatch({ type: "select", id }), []);
  const back = useCallback(() => dispatch({ type: "select", id: null }), []);
  const open = useCallback(() => {
    openTab({ agentId, workspaceId });
    close();
  }, [openTab, agentId, workspaceId, close]);
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  if (!agent) return <Text style={styles.text}>This agent is no longer available.</Text>;
  return (
    <View style={popoverStyles.body}>
      <View style={popoverStyles.header}>
        {!layout.compact && <Text style={styles.title}>Commands</Text>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the Commands tab"
          onPress={open}
          style={popoverStyles.link}
          hitSlop={8}
        >
          <Text style={linkStyle}>Open tab</Text>
          <Icon name="Maximize2" size={13} color={theme.colors.accent} />
        </Pressable>
      </View>
      {selected ? (
        <View style={popoverStyles.body}>
          <Pressable accessibilityRole="button" onPress={back} hitSlop={8}>
            <Text style={linkStyle}>Back to commands</Text>
          </Pressable>
          <CommandDetail
            key={`${selected.id}:${selected.mode}`}
            command={selected}
            agentId={agentId}
            styles={styles}
            placeholderColor={theme.colors.foregroundMuted}
            openAgent={null}
            frame="popover"
            onInvoked={close}
          />
        </View>
      ) : (
        <View style={popoverStyles.body}>
          <TextInput
            accessibilityLabel="Search commands"
            placeholder="Search commands"
            style={styles.input}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={state.search}
            onChangeText={search}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.isPending && <Text style={styles.muted}>Loading commands…</Text>}
          {query.isError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {query.error.message}
            </Text>
          )}
          {query.data?.warnings.map((warning) => (
            <Text key={warning} style={styles.warning}>
              {warning}
            </Text>
          ))}
          {GROUPS.map((scope) => (
            <CommandGroup
              key={scope}
              scope={scope}
              commands={filtered}
              styles={styles}
              select={select}
            />
          ))}
          {query.isSuccess && filtered.length === 0 && (
            <Text style={styles.muted}>No matching commands.</Text>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={refresh}
            disabled={query.isFetching}
            hitSlop={8}
          >
            <Text style={linkStyle}>{query.isFetching ? "Refreshing…" : "Refresh"}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const popoverStyles = StyleSheet.create({
  body: { gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  link: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto" },
  group: { gap: 8, paddingTop: 12 },
  row: { paddingVertical: 10, gap: 4 },
});
