import { type PluginAgentPanelProps, useAgent, useRpc } from "@getpaseo/plugin/client";
import type { RpcOutput } from "@getpaseo/plugin";
import { FlatList, Markdown, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo, useReducer, useState, type Dispatch, type ReactNode } from "react";
import { Pressable, Text, View, type ListRenderItemInfo } from "react-native";
import { invokeCommand, listCommands, readCommand, type Command } from "../shared/commands";
import { createStyles, type Styles } from "./styles";
import { useCommandCatalog } from "./catalog";

type Scope = Command["scope"] | "all";
const SCOPES: Scope[] = ["all", "project", "global", "session"];
const EMPTY_COMMANDS: Command[] = [];
const EMPTY_STRINGS: string[] = [];
const commandKey = (command: Command) => command.id;
function catalogContent(data: RpcOutput<typeof listCommands> | undefined) {
  return {
    commands: data?.commands ?? EMPTY_COMMANDS,
    warnings: data?.warnings ?? EMPTY_STRINGS,
    scannedDirectories: data?.directories ?? EMPTY_STRINGS,
  };
}
interface BrowserState {
  selectedId: string | null;
  search: string;
  scope: Scope;
  showDirectories: boolean;
}
type BrowserAction =
  | { type: "select"; id: string | null }
  | { type: "search"; search: string }
  | { type: "scope"; scope: Scope }
  | { type: "directories" };
function browserReducer(state: BrowserState, action: BrowserAction): BrowserState {
  switch (action.type) {
    case "select":
      return { ...state, selectedId: action.id };
    case "search":
      return { ...state, search: action.search };
    case "scope":
      return { ...state, scope: action.scope };
    case "directories":
      return { ...state, showDirectories: !state.showDirectories };
  }
}

interface ActionProps {
  title: string;
  onPress(): void;
  styles: Styles;
  disabled?: boolean;
  primary?: boolean;
}
function Action({ title, onPress, styles, disabled = false, primary = false }: ActionProps) {
  const buttonStyle = useMemo(
    () => [styles.button, primary && styles.primary, disabled && styles.disabled],
    [styles, primary, disabled],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={buttonStyle}
    >
      <Text style={primary ? styles.primaryText : styles.text}>{title}</Text>
    </Pressable>
  );
}

function CommandPreview({
  preview,
  styles,
}: {
  preview: UseQueryResult<{ body: string }>;
  styles: Styles;
}) {
  const { refetch } = preview;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  return (
    <View style={styles.gap}>
      <Text style={styles.title}>Command content</Text>
      {preview.isPending && <Text style={styles.muted}>Loading content…</Text>}
      {preview.isError && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {preview.error.message}
          </Text>
          <Action title="Retry preview" styles={styles} onPress={retry} />
        </>
      )}
      {preview.isSuccess && <Markdown>{preview.data.body || "_Empty command template._"}</Markdown>}
    </View>
  );
}

interface ScopeButtonProps {
  scope: Scope;
  active: Scope;
  styles: Styles;
  dispatch: Dispatch<BrowserAction>;
}
function ScopeButton({ scope, active, styles, dispatch }: ScopeButtonProps) {
  const select = useCallback(() => dispatch({ type: "scope", scope }), [dispatch, scope]);
  return <Action title={scope} styles={styles} primary={active === scope} onPress={select} />;
}

interface CommandRowProps {
  command: Command;
  selected: boolean;
  styles: Styles;
  dispatch: Dispatch<BrowserAction>;
}
function CommandRow({ command, selected, styles, dispatch }: CommandRowProps) {
  const select = useCallback(
    () => dispatch({ type: "select", id: command.id }),
    [dispatch, command.id],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const rowStyle = useMemo(() => [styles.row, selected && styles.selected], [styles, selected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${command.name}, ${command.scope}`}
      accessibilityState={accessibilityState}
      onPress={select}
      style={rowStyle}
    >
      <Text style={styles.text}>/{command.name}</Text>
      <Text numberOfLines={2} style={styles.muted}>
        {command.description || command.path || "Session command"}
      </Text>
      <Text style={styles.muted}>
        {command.scope} · {command.mode}
      </Text>
    </Pressable>
  );
}

interface SourcesProps {
  warnings: string[];
  directories: string[];
  styles: Styles;
}
function Sources({ warnings, directories, styles }: SourcesProps) {
  return (
    <View style={styles.toolbar}>
      {warnings.map((warning) => (
        <Text key={warning} style={styles.warning}>
          {warning}
        </Text>
      ))}
      {directories.map((directory) => (
        <Text key={directory} selectable style={styles.muted}>
          {directory}
        </Text>
      ))}
    </View>
  );
}

interface DetailProps {
  command: Command;
  agentId: string;
  styles: Styles;
  placeholderColor: string;
  openAgent: (() => void) | null;
  frame?: "screen" | "popover";
  onInvoked?: () => void;
}
interface DetailFrameProps {
  frame: "screen" | "popover";
  styles: Styles;
  children: ReactNode;
}
function DetailFrame({ frame, styles, children }: DetailFrameProps) {
  if (frame === "popover") return <View style={styles.content}>{children}</View>;
  return (
    <ScrollView
      style={styles.detail}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function CommandDetail({
  command,
  agentId,
  styles,
  placeholderColor,
  openAgent,
  frame = "screen",
  onInvoked,
}: DetailProps) {
  const [args, setArgs] = useState("");
  const status = useAgent(agentId, (agent) => agent.status);
  const read = useRpc(readCommand);
  const invoke = useRpc(invokeCommand);
  const preview = useQuery({
    queryKey: ["commands", "body", agentId, command.id],
    queryFn: () => read({ agentId, commandId: command.id }),
    enabled: command.path !== null,
    retry: false,
    staleTime: 0,
  });
  const send = useMutation({
    mutationFn: () => invoke({ agentId, commandId: command.id, args, mode: command.mode }),
    onSuccess: onInvoked,
  });
  const busy = status === "running" || status === "initializing";
  const previewUnavailable = command.path !== null && !preview.isSuccess;
  const disabled = busy || status === null || send.isPending || previewUnavailable;
  const actionTitle = command.mode === "native" ? "Run command" : "Send template";
  const { reset, mutate } = send;
  const changeArgs = useCallback(
    (value: string) => {
      setArgs(value);
      reset();
    },
    [reset],
  );
  const submit = useCallback(() => mutate(), [mutate]);
  return (
    <DetailFrame frame={frame} styles={styles}>
      <Text style={styles.title}>/{command.name}</Text>
      <Text style={styles.text}>{command.description || "No description"}</Text>
      <Text selectable style={styles.muted}>
        {command.path ?? "Reported by the current agent session"}
      </Text>
      {command.shadowedBy && (
        <Text style={styles.warning}>
          Same-name command takes precedence: {command.shadowedBy}. This file can be sent as a
          template.
        </Text>
      )}
      <Text style={styles.muted}>
        {command.mode === "native"
          ? "Runs the slash command loaded by this agent. The provider handles arguments and command settings."
          : "Sends this Markdown as a prompt. Supports $ARGUMENTS, $1–$9 and NAME=value. Frontmatter settings, shell substitutions and file directives are not executed by this plugin."}
      </Text>
      <TextInput
        accessibilityLabel="Command arguments"
        placeholder={command.argumentHint || "Arguments (optional)"}
        placeholderTextColor={placeholderColor}
        style={styles.input}
        value={args}
        editable={!send.isPending}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={changeArgs}
      />
      <View style={styles.actions}>
        <Action
          title={send.isPending ? "Sending…" : actionTitle}
          disabled={disabled}
          primary
          styles={styles}
          onPress={submit}
        />
        {openAgent && <Action title="Open agent" styles={styles} onPress={openAgent} />}
      </View>
      {busy && (
        <Text style={styles.muted}>Wait for the current turn to finish before sending.</Text>
      )}
      {send.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {send.error.message}
        </Text>
      )}
      {send.isSuccess && (
        <Text accessibilityRole="alert" style={styles.success}>
          {send.data.message}
        </Text>
      )}
      {command.path !== null && <CommandPreview preview={preview} styles={styles} />}
    </DetailFrame>
  );
}

function CommandBrowser({ theme, layout, params, navigation }: PluginAgentPanelProps) {
  const agentId = params.agentId;
  const styles = useMemo(() => createStyles(theme, layout.compact), [theme, layout.compact]);
  const { agent, query } = useCommandCatalog(agentId);
  const [state, dispatch] = useReducer(browserReducer, {
    selectedId: null,
    search: "",
    scope: "all",
    showDirectories: false,
  });
  const queryClient = useQueryClient();
  const { commands, warnings, scannedDirectories } = catalogContent(query.data);
  const selected = commands.find((command) => command.id === state.selectedId);
  const needle = state.search.toLowerCase().trim();
  const filtered = useMemo(
    () =>
      commands.filter((command) => {
        const matchesScope = state.scope === "all" || command.scope === state.scope;
        const searchable =
          `${command.name} ${command.description} ${command.path ?? ""}`.toLowerCase();
        return matchesScope && searchable.includes(needle);
      }),
    [commands, state.scope, needle],
  );
  const showList = !layout.compact || !selected;
  const showDetail = !layout.compact || Boolean(selected);
  const changeSearch = useCallback((search: string) => dispatch({ type: "search", search }), []);
  const toggleDirectories = useCallback(() => dispatch({ type: "directories" }), []);
  const back = useCallback(() => dispatch({ type: "select", id: null }), []);
  const openAgent = useCallback(() => navigation?.openAgent({ agentId }), [navigation, agentId]);
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ["commands", "body", agentId] });
  }, [refetch, queryClient, agentId]);
  const renderCommand = useCallback(
    ({ item }: ListRenderItemInfo<Command>) => (
      <CommandRow
        command={item}
        selected={state.selectedId === item.id}
        styles={styles}
        dispatch={dispatch}
      />
    ),
    [state.selectedId, styles],
  );
  const directories = state.showDirectories ? scannedDirectories : EMPTY_STRINGS;
  const header = useMemo(
    () => <Sources warnings={warnings} directories={directories} styles={styles} />,
    [warnings, directories, styles],
  );
  const empty = useMemo(
    () => (
      <View style={styles.empty}>
        <Text style={styles.muted}>
          {query.isSuccess
            ? "No commands match. Add a Markdown file to .agents/commands, then refresh."
            : ""}
        </Text>
      </View>
    ),
    [styles, query.isSuccess],
  );
  if (!agent)
    return (
      <View style={styles.empty}>
        <Text style={styles.text}>This agent is no longer available.</Text>
      </View>
    );
  return (
    <View style={styles.screen}>
      <View style={styles.columns}>
        {showList && (
          <View style={styles.list}>
            <View style={styles.toolbar}>
              <Text style={styles.title}>Commands · {commands.length}</Text>
              <Text numberOfLines={1} style={styles.muted}>
                {agent.title ?? agentId} · {agent.provider}
              </Text>
              <TextInput
                accessibilityLabel="Search commands"
                placeholder="Search commands"
                placeholderTextColor={theme.colors.foregroundMuted}
                style={styles.input}
                value={state.search}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={changeSearch}
              />
              <View style={styles.actions}>
                {SCOPES.map((scope) => (
                  <ScopeButton
                    key={scope}
                    scope={scope}
                    styles={styles}
                    active={state.scope}
                    dispatch={dispatch}
                  />
                ))}
              </View>
              <View style={styles.actions}>
                <Action
                  title={query.isFetching ? "Refreshing…" : "Refresh"}
                  styles={styles}
                  disabled={query.isFetching}
                  onPress={refresh}
                />
                <Action title="Directories" styles={styles} onPress={toggleDirectories} />
              </View>
              {query.isPending && <Text style={styles.muted}>Loading commands…</Text>}
              {query.isError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {query.error.message}
                </Text>
              )}
            </View>
            <FlatList
              data={filtered}
              keyExtractor={commandKey}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={header}
              ListEmptyComponent={empty}
              renderItem={renderCommand}
            />
          </View>
        )}
        {showDetail && (
          <View style={styles.detail}>
            {layout.compact && (
              <View style={styles.toolbar}>
                <Action title="Back to commands" styles={styles} onPress={back} />
              </View>
            )}
            {selected ? (
              <CommandDetail
                key={`${agentId}:${selected.id}:${selected.mode}`}
                command={selected}
                agentId={agentId}
                styles={styles}
                placeholderColor={theme.colors.foregroundMuted}
                openAgent={navigation ? openAgent : null}
              />
            ) : (
              <View style={styles.empty}>
                <Text style={styles.muted}>
                  Select a command to preview its content and run it.
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

export function CommandsPanel(props: PluginAgentPanelProps) {
  return <CommandBrowser key={props.params.agentId} {...props} />;
}
