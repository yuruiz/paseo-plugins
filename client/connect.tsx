import { ConnectBrowser } from "./connect-browser.js";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useReducer } from "react";
import { Text, View } from "react-native";
import type { RpcOutput } from "@getpaseo/plugin";
import {
  configureConnect,
  connectStatus,
  setConnectEnabled,
  deleteConnect,
  testConnect,
} from "../shared/onepassword.js";
import { QuestionButton, useQuestionStyles } from "./question-ui.js";

interface FormState {
  url: string;
  token: string;
  status: "idle" | "pending" | "saved" | "error";
  message: string;
}
type Action =
  | { type: "url"; value: string }
  | { type: "token"; value: string }
  | { type: "pending" }
  | { type: "saved" | "error"; message: string };
function reduce(state: FormState, action: Action): FormState {
  if (action.type === "url" || action.type === "token")
    return { ...state, [action.type]: action.value, status: "idle", message: "" };
  if (action.type === "pending") return { ...state, token: "", status: "pending", message: "" };
  return { ...state, token: "", status: action.type, message: action.message };
}

export function ConnectSettings(props: PluginSurfaceProps) {
  return <ConnectScreen key={props.host.id} {...props} />;
}

function ConnectScreen(props: PluginSurfaceProps) {
  const getStatus = useRpc(connectStatus);
  const queryKey = useMemo(() => ["connect-status", props.host.id], [props.host.id]);
  const status = useQuery({ queryKey, queryFn: () => getStatus({}) });
  const styles = useQuestionStyles(props.theme, props.layout.compact);
  const retry = useCallback(() => {
    void status.refetch();
  }, [status]);
  if (status.isPending) return <Text style={styles.muted}>Loading configuration…</Text>;
  if (status.isError)
    return (
      <View style={styles.card}>
        <Text accessibilityRole="alert" style={styles.error}>
          Could not load Connect configuration. Check the host connection.
        </Text>
        <QuestionButton theme={props.theme} label="Retry loading configuration" onPress={retry} />
      </View>
    );
  return <ConnectForm {...props} saved={status.data} queryKey={queryKey} />;
}

interface ConnectFormProps extends PluginSurfaceProps {
  saved: RpcOutput<typeof connectStatus>;
  queryKey: string[];
}

function ConnectForm({ host, theme, layout, saved, queryKey }: ConnectFormProps) {
  const configure = useRpc(configureConnect);
  const setEnabled = useRpc(setConnectEnabled);
  const deleteConfiguration = useRpc(deleteConnect);
  const testConnection = useRpc(testConnect);
  const cache = useQueryClient();
  const [form, dispatch] = useReducer(reduce, {
    url: saved.url ?? "",
    token: "",
    status: "idle",
    message: "",
  });
  const styles = useQuestionStyles(theme, layout.compact);
  const editUrl = useCallback((value: string) => dispatch({ type: "url", value }), []);
  const editToken = useCallback((value: string) => dispatch({ type: "token", value }), []);
  const run = useCallback(
    (operation: () => Promise<string>, failure: string) => {
      dispatch({ type: "pending" });
      // Credentials stay outside React Query's mutation cache.
      void operation()
        .then(async (message) => {
          await cache.cancelQueries({ queryKey: ["connect-browser", host.id] });
          cache.removeQueries({ queryKey: ["connect-browser", host.id] });
          await cache.invalidateQueries({ queryKey });
          dispatch({ type: "saved", message });
          return undefined;
        })
        .catch(() => dispatch({ type: "error", message: failure }));
    },
    [cache, queryKey, host.id],
  );
  const save = useCallback(() => {
    const input = { url: form.url.trim(), token: form.token };
    run(async () => {
      await configure(input);
      return "Configuration saved. Connect access is enabled.";
    }, "Could not save Connect. Check the URL, host connection and storage permissions; re-enter the token to retry.");
  }, [configure, form.url, form.token, run]);
  const toggle = useCallback(() => {
    run(async () => {
      await setEnabled({ enabled: !saved.enabled });
      return saved.enabled
        ? "Connect access disabled. Saved credentials are retained."
        : "Connect access enabled.";
    }, "Could not change Connect access. Check the host connection and storage permissions, then retry.");
  }, [setEnabled, saved.enabled, run]);
  const remove = useCallback(() => {
    run(async () => {
      await deleteConfiguration({});
      return "Saved Connect configuration deleted.";
    }, "Could not delete Connect configuration. Check the host connection and storage permissions, then retry.");
  }, [deleteConfiguration, run]);
  const test = useCallback(() => {
    run(async () => {
      const result = await testConnection({});
      return `Connection successful. ${result.vaultCount} accessible vault(s). Write permissions were not tested.`;
    }, "Connection test failed. Check the saved URL, token permissions and Connect server availability. Save any changes before testing again.");
  }, [testConnection, run]);
  const pending = form.status === "pending";
  const canDelete = saved.configured || saved.error !== null;
  const access = saved.enabled ? "Enabled" : "Disabled";
  return (
    <View style={styles.body}>
      <View style={styles.card}>
        <Text style={styles.muted}>
          Connect lets agents on this host list, read, create and replace items allowed by the
          token. Read results include secret values in agent context.
        </Text>
        <Text style={styles.text}>
          {saved.configured ? `${access}: ${saved.url}` : "Not configured"}
        </Text>
        {saved.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {saved.error}
          </Text>
        ) : null}
        <Text style={styles.muted}>
          Configuration survives host restart and plugin reload. The token is stored in a file
          readable only by the host user; it is not encrypted and is never returned to this screen.
        </Text>
        <TextInput
          accessibilityLabel="Connect URL"
          value={form.url}
          onChangeText={editUrl}
          placeholder="https://connect.example.com"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="Connect token"
          value={form.token}
          onChangeText={editToken}
          placeholder={
            saved.configured ? "Enter a replacement token to save" : "Connect access token"
          }
          secureTextEntry
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
          style={styles.input}
        />
        <View style={styles.row}>
          <QuestionButton
            theme={theme}
            label="Save and enable"
            onPress={save}
            disabled={pending || !form.url.trim() || !form.token}
            primary
          />
          <QuestionButton
            theme={theme}
            label="Test saved connection"
            onPress={test}
            disabled={pending || !saved.configured}
          />
          <QuestionButton
            theme={theme}
            label={saved.enabled ? "Disable access" : "Enable access"}
            onPress={toggle}
            disabled={pending || !saved.configured}
          />
          <QuestionButton
            theme={theme}
            label="Delete saved configuration"
            onPress={remove}
            disabled={pending || !canDelete}
          />
        </View>
        {pending ? <Text style={styles.muted}>Working…</Text> : null}
        {form.status === "saved" ? <Text style={styles.text}>{form.message}</Text> : null}
        {form.status === "error" ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {form.message}
          </Text>
        ) : null}
      </View>
      {saved.configured && saved.url && !pending ? (
        <ConnectBrowser key={saved.url} host={host} theme={theme} layout={layout} url={saved.url} />
      ) : null}
    </View>
  );
}
