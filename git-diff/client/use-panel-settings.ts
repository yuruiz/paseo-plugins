import { settingsRpc } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { defaultSettings, type PanelSettings, panelSettingsSchema } from "../shared/settings";

const contracts = settingsRpc("git-panel");
const isDragSetting = (key: string) =>
  key === "sidebarWidth" || key === "splitRatio" || key === "historyDetailsRatio";

// Host storage, shared by panels and devices. Queue only the changed fields so a
// second panel cannot accidentally overwrite unrelated settings with stale values.
const sharedPreferences = new Map<string, { values: PanelSettings; listeners: Set<() => void> }>();
export function usePanelSettings(hostKey = "default") {
  let shared = sharedPreferences.get(hostKey);
  if (!shared) {
    shared = { values: defaultSettings, listeners: new Set() };
    sharedPreferences.set(hostKey, shared);
  }
  const store = shared;
  const values = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        store.listeners.add(listener);
        return () => {
          store.listeners.delete(listener);
        };
      },
      [store],
    ),
    () => store.values,
    () => store.values,
  );
  const setValues = useCallback(
    (value: PanelSettings | ((previous: PanelSettings) => PanelSettings)) => {
      const next = typeof value === "function" ? value(store.values) : value;
      if (JSON.stringify(next) === JSON.stringify(store.values)) return;
      store.values = next;
      store.listeners.forEach((listener) => {
        listener();
      });
    },
    [store],
  );
  const read = useRpc(contracts.read);
  const write = useRpc(contracts.write);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Partial<PanelSettings>>({});
  const revision = useRef<string | null>(null);
  const stored = useRef(defaultSettings);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const commitRequested = useRef(false);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    try {
      const result = await read({});
      if (!alive.current) return;
      if (result.status !== "ready") {
        revision.current = result.revision;
        setLoaded(true);
        setError(`${result.error}；可在设置中恢复默认。`);
        return;
      }
      stored.current = panelSettingsSchema.parse(result.values);
      revision.current = result.revision;
      setValues({ ...stored.current, ...pending.current });
      setLoaded(true);
      setError(null);
      setRequest((value) => value + 1);
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [read, setValues]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const flush = useCallback(
    async function flush() {
      if (inFlight.current) {
        commitRequested.current = true;
        return;
      }
      if (revision.current === null || !Object.keys(pending.current).length) return;
      commitRequested.current = false;
      inFlight.current = true;
      if (alive.current) setSaving(true);
      const patch = pending.current;
      pending.current = {};
      try {
        let saved = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const result = await write({
            revision: revision.current ?? "",
            values: panelSettingsSchema.parse({ ...stored.current, ...patch }),
          });
          if (result.status === "saved") {
            stored.current = panelSettingsSchema.parse(result.values);
            revision.current = result.revision;
            saved = true;
            break;
          }
          if (result.status === "invalid") throw new Error(result.error);
          const fresh = await read({});
          if (fresh.status !== "ready") throw new Error(fresh.error);
          stored.current = panelSettingsSchema.parse(fresh.values);
          revision.current = fresh.revision;
        }
        if (!saved) throw new Error("设置同时被其他面板修改，请重试保存。");
        if (alive.current) {
          setValues({ ...stored.current, ...pending.current });
          setError(null);
        }
      } catch (failure) {
        pending.current = { ...patch, ...pending.current };
        if (alive.current) setError(failure instanceof Error ? failure.message : String(failure));
        return;
      } finally {
        inFlight.current = false;
        if (alive.current) setSaving(false);
      }
      if (Object.keys(pending.current).length) {
        if (
          alive.current &&
          !commitRequested.current &&
          Object.keys(pending.current).every(isDragSetting)
        )
          setRequest((value) => value + 1);
        else await flush();
      }
    },
    [read, write, setValues],
  );
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      void flushRef.current();
    },
    [],
  );
  useEffect(() => {
    if (!loaded || request < 0) return;
    const timer = setTimeout(() => {
      void flush();
    }, 180);
    return () => clearTimeout(timer);
  }, [request, loaded, flush]);

  const update = useCallback(
    (patch: Partial<PanelSettings>) => {
      pending.current = { ...pending.current, ...patch };
      setValues((previous) => panelSettingsSchema.parse({ ...previous, ...patch }));
      setRequest((value) => value + 1);
      if (Object.keys(patch).some((key) => !isDragSetting(key))) void flushRef.current();
    },
    [setValues],
  );
  const retry = useCallback(() => {
    void reload().then(() => flushRef.current());
  }, [reload]);
  return {
    values,
    update,
    loaded,
    saving: !error && (saving || Object.keys(pending.current).length > 0),
    error,
    retry,
    flush: () => {
      void flushRef.current();
    },
    reset: () => update(defaultSettings),
  };
}
