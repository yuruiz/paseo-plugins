import type { PluginTheme } from "@getpaseo/plugin";
import { useAgents, useSettings } from "@getpaseo/plugin/client";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Modal, ScrollView, Text, TextInput, View } from "react-native";
import type { DiffLine, FileDiff } from "../shared/contracts";
import { type ReviewComment, reviewDraftSettings } from "../shared/review-comments";
import { ToolButton } from "./controls";
import { commentTarget, type ReviewScope, type ReviewTarget } from "./review-comments-model";
import { ReviewComposerSync } from "./review-composer";
import { panelTokens } from "./theme";

type ReviewApi = {
  comments: ReviewComment[];
  save(comment: ReviewComment): Promise<boolean>;
  remove(ids: string[]): Promise<boolean>;
};
const ReviewContext = createContext<ReviewApi | null>(null);
export function ReviewProvider({
  session,
  workspaceId,
  directory,
  hostId,
  theme,
  children,
}: {
  session: string;
  workspaceId?: string;
  directory: string;
  hostId?: string;
  theme: PluginTheme;
  children: ReactNode;
}) {
  const settings = useSettings(reviewDraftSettings);
  const agents = useAgents({
    where: (agent) =>
      (!hostId || agent.hostId === hostId) &&
      (workspaceId ? agent.workspaceId === workspaceId : agent.cwd === directory),
  });
  const latest = useRef(settings);
  latest.current = settings;
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const all = settings.status === "ready" ? settings.values.comments : [];
  const comments = useMemo(
    () => all.filter((comment) => comment.session === session),
    [all, session],
  );
  const write = useCallback(async (update: (comments: ReviewComment[]) => ReviewComment[]) => {
    const current = latest.current;
    if (current.status !== "ready") {
      await current.reload();
      return false;
    }
    if (current.saving) return false;
    const saved = await current.save(
      { comments: update(current.values.comments) },
      current.revision,
    );
    if (!saved) await current.reload();
    return saved;
  }, []);
  const remove = useCallback(
    (ids: string[]) => write((current) => current.filter((comment) => !ids.includes(comment.id))),
    [write],
  );
  return (
    <ReviewContext.Provider
      value={{
        comments,
        save: (comment) =>
          write((current) => [...current.filter((item) => item.id !== comment.id), comment]),
        remove,
      }}
    >
      {agents.map((agent) => (
        <ReviewComposerSync
          key={agent.key}
          agentId={agent.id}
          comments={comments}
          onRemove={remove}
          onError={setError}
          retry={retry}
        />
      ))}
      <View style={{ flex: 1, minHeight: 0 }}>
        {children}
        {error ? (
          <View style={{ flexDirection: "row", alignItems: "center", padding: 6, gap: 6 }}>
            <Text
              accessibilityRole="alert"
              style={{ flex: 1, color: panelTokens(theme).statusDanger }}
            >
              {error}
            </Text>
            <ToolButton
              theme={theme}
              icon="refresh"
              label="重试评论同步"
              onPress={() => {
                setError(null);
                setRetry((value) => value + 1);
              }}
            />
          </View>
        ) : null}
      </View>
    </ReviewContext.Provider>
  );
}

export function ReviewableDiff({
  scope,
  theme,
  path,
  children,
}: {
  scope: ReviewScope;
  theme: PluginTheme;
  path: string;
  children: (
    onComment?: (line: DiffLine, side: "old" | "new", source: FileDiff) => void,
    hasComment?: (line: DiffLine, side: "old" | "new") => boolean,
  ) => ReactNode;
}) {
  const review = useContext(ReviewContext);
  const c = panelTokens(theme);
  const [target, setTarget] = useState<ReviewTarget | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function start(line: DiffLine, side: "old" | "new", source: FileDiff) {
    const next = commentTarget(source, line, side, scope);
    const existing = review?.comments.find(
      (comment) =>
        comment.scope === scope.scope &&
        comment.filePath === next.filePath &&
        comment.side === side &&
        comment.lineNumber === next.lineNumber &&
        comment.context.targetLine.content === next.context.targetLine.content,
    );
    setTarget(existing ?? next);
    setBody(existing?.body ?? "");
    setError(null);
  }
  async function save() {
    if (!target || !body.trim() || !review) return;
    setBusy(true);
    try {
      const saved = await review.save({ ...target, body: body.trim() });
      if (saved) setTarget(null);
      else setError("保存失败，请重试；评论内容已保留。");
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {children(review ? start : undefined, (line, side) =>
        Boolean(
          review?.comments.some(
            (comment) =>
              comment.scope === scope.scope &&
              comment.filePath === path &&
              comment.context.targetLine.content === line.content &&
              comment.side === side &&
              comment.lineNumber === (side === "old" ? line.oldLine : line.newLine),
          ),
        ),
      )}
      {target ? (
        <Modal
          transparent
          onRequestClose={() => {
            if (!busy) setTarget(null);
          }}
        >
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: "#00000066",
              padding: 16,
            }}
          >
            <View
              style={{
                width: "100%",
                maxWidth: 650,
                maxHeight: "90%",
                padding: 16,
                gap: 12,
                backgroundColor: c.surface0,
              }}
            >
              <Text style={{ color: c.foreground }}>
                {target.filePath} · {target.side === "old" ? "原始" : "修改"}第 {target.lineNumber}{" "}
                行
              </Text>
              <ScrollView style={{ maxHeight: 180 }}>
                <Text
                  selectable
                  style={{ color: c.foregroundMuted, fontFamily: c.mono, fontSize: 12 }}
                >
                  {target.context.lines
                    .map(
                      (line) =>
                        `${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "} ${line.content}`,
                    )
                    .join("\n")}
                </Text>
              </ScrollView>
              <TextInput
                multiline
                autoFocus
                accessibilityLabel="Review 评论"
                placeholder="添加 Review 评论…"
                value={body}
                onChangeText={setBody}
                editable={!busy}
                style={{
                  minHeight: 110,
                  padding: 10,
                  borderWidth: 1,
                  borderColor: c.border,
                  color: c.foreground,
                }}
              />
              {error ? (
                <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>
                  {error}
                </Text>
              ) : null}
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                {review?.comments.some((comment) => comment.id === target.id) ? (
                  <ToolButton
                    theme={theme}
                    text="删除"
                    label="删除 Review 评论"
                    disabled={busy}
                    onPress={() => {
                      setBusy(true);
                      void review
                        .remove([target.id])
                        .then((saved) => {
                          if (saved) setTarget(null);
                          else setError("删除失败，请重试。");
                        })
                        .catch((error) =>
                          setError(error instanceof Error ? error.message : String(error)),
                        )
                        .finally(() => setBusy(false));
                    }}
                  />
                ) : null}
                <ToolButton
                  theme={theme}
                  text="取消"
                  label="取消 Review 评论"
                  disabled={busy}
                  onPress={() => setTarget(null)}
                />
                <ToolButton
                  theme={theme}
                  text="保存评论"
                  label="保存 Review 评论"
                  busy={busy}
                  disabled={!body.trim() || body.trim().length > 10000}
                  onPress={() => void save()}
                />
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
