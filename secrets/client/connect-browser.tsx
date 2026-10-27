import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useReducer, useState } from "react";
import { Text, View } from "react-native";
import {
  listConnectVaults,
  listConnectItems,
  type ConnectVault,
  type ConnectItemSummary,
} from "../shared/onepassword.js";
import { QuestionButton, useQuestionStyles } from "./question-ui.js";

interface BrowserProps extends PluginHostProps {
  url: string;
}

export function ConnectBrowser(props: BrowserProps) {
  const list = useRpc(listConnectVaults);
  const [selectedId, select] = useState("");
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
    void vaults.refetch();
  }, [vaults]);
  const options = useMemo(
    () => [
      { value: "", label: "Select a vault" },
      ...(vaults.data ?? []).map((vault) => ({ value: vault.id, label: vault.name })),
    ],
    [vaults.data],
  );
  const selected = vaults.data?.find((vault) => vault.id === selectedId);
  return (
    <View style={styles.card} testID="connect-browser">
      <Text style={styles.text}>Browse Connect items</Text>
      <Text style={styles.muted}>
        Choose a vault to view item metadata. Secret field values are not loaded.
      </Text>
      <QuestionButton
        theme={props.theme}
        label={vaults.isFetching ? "Loading vaults…" : "Refresh vaults"}
        onPress={refresh}
        disabled={vaults.isFetching}
      />
      {vaults.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Could not load vaults. Check the saved connection and token permissions, then refresh.
        </Text>
      ) : null}
      {vaults.isSuccess && vaults.data.length === 0 ? (
        <Text style={styles.muted}>No accessible vaults.</Text>
      ) : null}
      {vaults.isSuccess && vaults.data.length > 0 ? (
        <SettingsSelect
          label="Vault"
          value={selected?.id ?? ""}
          options={options}
          onValueChange={select}
          disabled={vaults.isFetching}
        />
      ) : null}
      {vaults.isSuccess && selected ? (
        <VaultItems key={selected.id} {...props} vault={selected} />
      ) : null}
    </View>
  );
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

function VaultItems({ host, url, vault, theme, layout }: VaultItemsProps) {
  const list = useRpc(listConnectItems);
  const [filter, dispatch] = useReducer(filterReducer, { query: "", limit: 50 });
  const styles = useQuestionStyles(theme, layout.compact);
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
  const refresh = useCallback(() => {
    void items.refetch();
  }, [items]);
  const search = useCallback((value: string) => dispatch({ type: "query", value }), []);
  const more = useCallback(() => dispatch({ type: "more" }), []);
  const matching = useMemo(() => {
    const needle = filter.query.trim().toLowerCase();
    return (items.data ?? []).filter((item) => item.title.toLowerCase().includes(needle));
  }, [items.data, filter.query]);
  const visible = matching.slice(0, filter.limit);
  return (
    <View style={styles.body}>
      <Text style={styles.text}>Items in {vault.name}</Text>
      <Text selectable style={styles.muted}>
        Vault ID: {vault.id}
      </Text>
      <TextInput
        accessibilityLabel="Filter items by title"
        value={filter.query}
        onChangeText={search}
        placeholder="Filter by title"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <QuestionButton
        theme={theme}
        label={items.isFetching ? "Loading items…" : "Refresh items"}
        onPress={refresh}
        disabled={items.isFetching}
      />
      {items.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Could not load items. Check vault access and the Connect server, then refresh.
        </Text>
      ) : null}
      {items.isSuccess ? (
        <Text style={styles.muted}>{matching.length} matching item(s)</Text>
      ) : null}
      {items.isSuccess && items.data.length === 0 ? (
        <Text style={styles.muted}>This vault has no items.</Text>
      ) : null}
      {items.isSuccess && items.data.length > 0 && matching.length === 0 ? (
        <Text style={styles.muted}>No items match this title.</Text>
      ) : null}
      {items.isSuccess
        ? visible.map((item) => <ItemRow key={item.id} item={item} theme={theme} />)
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
}
function ItemRow({ item, theme }: ItemRowProps) {
  const styles = useQuestionStyles(theme);
  return (
    <View style={styles.field}>
      <Text selectable style={styles.text}>
        {item.title || "Untitled item"}
      </Text>
      <Text selectable style={styles.muted}>
        {item.category} · Item ID: {item.id}
      </Text>
      {item.tags.length > 0 ? (
        <Text selectable style={styles.muted}>
          Tags: {item.tags.join(", ")}
        </Text>
      ) : null}
      {item.updatedAt ? (
        <Text style={styles.muted}>Updated: {new Date(item.updatedAt).toLocaleString()}</Text>
      ) : null}
    </View>
  );
}
