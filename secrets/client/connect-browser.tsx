import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useReducer, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  connectStatus,
  listConnectVaults,
  listConnectItems,
  shareConnectItem,
  type ConnectVault,
  type ConnectItemSummary,
} from "../shared/onepassword.js";
import { QuestionButton, useQuestionStyles } from "./question-ui.js";

interface BrowserProps extends PluginHostProps {
  url: string;
  autoSelectFirst?: boolean;
  agentId?: string;
  shareEnabled?: boolean;
  onProvideSecrets?(): void;
}

interface ConnectedSecretsProps extends PluginHostProps {
  agentId: string;
  onProvideSecrets(): void;
}

const compactStyles = StyleSheet.create({
  body: { gap: 8 },
  toolbar: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  grow: { flex: 1, minWidth: 0 },
  vaultButton: { flex: 1, minWidth: 80, paddingVertical: 5 },
  search: { paddingHorizontal: 10, paddingVertical: 6, fontSize: 13 },
  item: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  shareAction: { width: 148, flexShrink: 0 },
});

export function ConnectedSecrets(props: ConnectedSecretsProps) {
  const getStatus = useRpc(connectStatus);
  const styles = useQuestionStyles(props.theme, props.layout.compact);
  const queryKey = useMemo(() => ["connect-status", props.host.id], [props.host.id]);
  const status = useQuery({ queryKey, queryFn: () => getStatus({}) });
  const retry = useCallback(() => {
    void status.refetch();
  }, [status]);
  if (status.isPending) return <Text style={styles.muted}>Loading Connect secrets…</Text>;
  if (status.isError)
    return (
      <View style={styles.body}>
        <Text accessibilityRole="alert" style={styles.error}>
          Could not load Connect configuration. Check the host connection.
        </Text>
        <QuestionButton theme={props.theme} label="Retry loading configuration" onPress={retry} />
      </View>
    );
  if (!status.data.configured || !status.data.url)
    return (
      <View style={styles.body}>
        <Text style={styles.muted}>
          No Connect connection configured. Open Settings → Plugins → Secrets → 1Password Connect to
          connect your vaults.
        </Text>
        {status.data.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {status.data.error}
          </Text>
        ) : null}
        <QuestionButton
          theme={props.theme}
          label="Provide secrets"
          onPress={props.onProvideSecrets}
          compact
        />
      </View>
    );
  return (
    <ConnectBrowser
      key={status.data.url}
      {...props}
      url={status.data.url}
      shareEnabled={status.data.enabled}
      autoSelectFirst
    />
  );
}

export function ConnectBrowser(props: BrowserProps) {
  const list = useRpc(listConnectVaults);
  const [selectedId, select] = useState("");
  const [choosingVault, setChoosingVault] = useState(false);
  const cache = useQueryClient();
  const styles = useQuestionStyles(props.theme, props.layout.compact);
  const queryKey = useMemo(
    () => ["connect-browser", props.host.id, props.url, "vaults"],
    [props.host.id, props.url],
  );
  const vaults = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const result = await list({});
      if (signal.aborted) throw new Error("Vault request canceled.");
      return result.vaults;
    },
    gcTime: 0,
    retry: false,
  });
  const refresh = useCallback(() => {
    void cache.invalidateQueries({ queryKey: ["connect-browser", props.host.id, props.url] });
  }, [cache, props.host.id, props.url]);
  const toggleVault = useCallback(() => setChoosingVault((value) => !value), []);
  const chooseVault = useCallback((id: string) => {
    select(id);
    setChoosingVault(false);
  }, []);
  const options = useMemo(
    () => (vaults.data ?? []).map((vault) => ({ value: vault.id, label: vault.name })),
    [vaults.data],
  );
  const selected =
    vaults.data?.find((vault) => vault.id === selectedId) ??
    (props.autoSelectFirst ? vaults.data?.[0] : undefined);
  const noVaults = options.length === 0;
  const vaultState = useMemo(
    () => ({ expanded: choosingVault, disabled: noVaults }),
    [choosingVault, noVaults],
  );
  return (
    <View style={compactStyles.body} testID="connect-browser">
      <View style={compactStyles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Select vault: ${selected?.name ?? "none"}`}
          accessibilityState={vaultState}
          disabled={noVaults}
          onPress={toggleVault}
          style={compactStyles.vaultButton}
        >
          <Text style={styles.text} numberOfLines={1}>
            {selected?.name ?? (vaults.isPending ? "Loading…" : "Select vault")} ▾
          </Text>
        </Pressable>
        <QuestionButton
          theme={props.theme}
          label="Refresh"
          icon="RefreshCw"
          iconOnly
          variant="ghost"
          onPress={refresh}
          disabled={vaults.isFetching}
          compact
        />
        {props.onProvideSecrets ? (
          <QuestionButton
            theme={props.theme}
            label="Provide secrets"
            icon="Plus"
            onPress={props.onProvideSecrets}
            compact
          />
        ) : null}
      </View>
      {choosingVault ? (
        <View style={compactStyles.body}>
          {options.map((option) => (
            <VaultOption
              key={option.value}
              {...option}
              theme={props.theme}
              onSelect={chooseVault}
            />
          ))}
        </View>
      ) : null}
      {vaults.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Could not load vaults. Check the saved connection and token permissions, then refresh.
        </Text>
      ) : null}
      {vaults.isSuccess && vaults.data.length === 0 ? (
        <Text style={styles.muted}>No accessible vaults.</Text>
      ) : null}
      {props.agentId && !props.shareEnabled ? (
        <Text style={styles.muted}>
          Agent access is disabled. Enable it in Connect settings to share.
        </Text>
      ) : null}
      {vaults.isSuccess && selected ? (
        <VaultItems key={selected.id} {...props} vault={selected} />
      ) : null}
    </View>
  );
}

function VaultOption({
  value,
  label,
  theme,
  onSelect,
}: {
  value: string;
  label: string;
  theme: PluginHostProps["theme"];
  onSelect(id: string): void;
}) {
  const select = useCallback(() => onSelect(value), [onSelect, value]);
  return <QuestionButton theme={theme} label={label} onPress={select} compact />;
}

interface VaultItemsProps extends BrowserProps {
  vault: ConnectVault;
}
interface FilterState {
  query: string;
  limit: number;
}
type FilterAction = { type: "query"; value: string } | { type: "more" };
function filterReducer(state: FilterState, action: FilterAction): FilterState {
  if (action.type === "query") return { query: action.value, limit: 50 };
  return { ...state, limit: state.limit + 50 };
}

function VaultItems({ host, url, vault, theme, layout, agentId, shareEnabled }: VaultItemsProps) {
  const list = useRpc(listConnectItems);
  const [filter, dispatch] = useReducer(filterReducer, { query: "", limit: 50 });
  const styles = useQuestionStyles(theme, layout.compact);
  const searchStyle = useMemo(() => [styles.input, compactStyles.search], [styles.input]);
  const queryKey = useMemo(
    () => ["connect-browser", host.id, url, "items", vault.id],
    [host.id, url, vault.id],
  );
  const items = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const result = await list({ vaultId: vault.id });
      if (signal.aborted) throw new Error("Item request canceled.");
      return result.items;
    },
    gcTime: 0,
    retry: false,
  });
  const search = useCallback((value: string) => dispatch({ type: "query", value }), []);
  const more = useCallback(() => dispatch({ type: "more" }), []);
  const matching = useMemo(() => {
    const needle = filter.query.trim().toLowerCase();
    return (items.data ?? []).filter((item) => item.title.toLowerCase().includes(needle));
  }, [items.data, filter.query]);
  const visible = matching.slice(0, filter.limit);
  return (
    <View style={compactStyles.body}>
      <TextInput
        accessibilityLabel="Filter items by title"
        value={filter.query}
        onChangeText={search}
        placeholder="Search secrets…"
        autoCapitalize="none"
        autoCorrect={false}
        style={searchStyle}
      />
      {items.isPending ? <Text style={styles.muted}>Loading secrets…</Text> : null}
      {items.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Could not load items. Check vault access and the Connect server, then refresh.
        </Text>
      ) : null}
      {items.isSuccess && items.data.length === 0 ? (
        <Text style={styles.muted}>This vault has no items.</Text>
      ) : null}
      {items.isSuccess && items.data.length > 0 && matching.length === 0 ? (
        <Text style={styles.muted}>No items match this title.</Text>
      ) : null}
      {items.isSuccess
        ? visible.map((item) => (
            <ItemRow
              key={`${agentId ?? "settings"}:${item.id}`}
              item={item}
              theme={theme}
              vaultId={vault.id}
              agentId={agentId}
              shareEnabled={shareEnabled}
            />
          ))
        : null}
      {items.isSuccess && visible.length < matching.length ? (
        <QuestionButton theme={theme} label="Show more items" onPress={more} />
      ) : null}
    </View>
  );
}

interface ItemRowProps {
  item: ConnectItemSummary;
  theme: PluginHostProps["theme"];
  vaultId: string;
  agentId?: string;
  shareEnabled?: boolean;
}
function ItemRow({ item, theme, vaultId, agentId, shareEnabled }: ItemRowProps) {
  const styles = useQuestionStyles(theme);
  const rowStyle = useMemo(
    () => [compactStyles.item, { borderBottomColor: theme.colors.border }],
    [theme.colors.border],
  );
  const share = useRpc(shareConnectItem);
  const sharing = useMutation({
    mutationFn: () => {
      if (!agentId) throw new Error("Select an agent first.");
      return share({ agentId, vaultId, itemId: item.id });
    },
    retry: false,
    gcTime: 0,
  });
  const { mutate } = sharing;
  const send = useCallback(() => mutate(), [mutate]);
  let shareLabel = "Share with agent";
  if (sharing.isPending) shareLabel = "Sharing…";
  else if (sharing.isSuccess) shareLabel = "Shared with agent";
  return (
    <View style={rowStyle}>
      <View style={compactStyles.itemRow}>
        <View style={compactStyles.grow}>
          <Text selectable style={styles.text} numberOfLines={2}>
            {item.title || "Untitled item"}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {item.category.replaceAll("_", " ").toLowerCase()}
          </Text>
        </View>
        {agentId ? (
          <View style={compactStyles.shareAction}>
            <QuestionButton
              theme={theme}
              label={shareLabel}
              icon={sharing.isSuccess ? "Check" : "Send"}
              variant={sharing.isSuccess ? "success" : "tonal"}
              onPress={send}
              disabled={!shareEnabled || sharing.isPending || sharing.isSuccess}
              compact
            />
          </View>
        ) : null}
      </View>
      {sharing.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Could not share. Check Connect access and the agent connection, then retry.
        </Text>
      ) : null}
    </View>
  );
}
