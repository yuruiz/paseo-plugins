import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Modal, ScrollView, Text, TextInput, View } from "react-native";
import type { DiffLine, FileDiff } from "../shared/contracts";
import { type ReviewComment, reviewDraftSettings } from "../shared/review-comments";
import { ToolButton } from "./controls";
import {
  commentTarget,
  type ReviewScope,
  type ReviewTarget,
  reviewAttachment,
} from "./review-comments-model";
import { panelTokens } from "./theme";

type ReviewApi = {
  comments: ReviewComment[];
  setScope(scope: ReviewScope): void;
  save(comment: ReviewComment): Promise<boolean>;
  remove(ids: string[]): Promise<boolean>;
};
const ReviewContext = createContext<ReviewApi | null>(null);
export function ReviewProvider({
  session,
  workspaceId,
  directory,
  theme,
  children,
}: {
  session: string;
  workspaceId?: string;
  directory: string;
  theme: PluginTheme;
  children: ReactNode;
}) {
  const settings = useSettings(reviewDraftSettings);
  const paseo = usePaseo();
  const c = panelTokens(theme);
  const [scope, setScope] = useState<ReviewScope | null>(null);
  const [recipients, setRecipients] = useState<{ id: string; title: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const pending = useRef<{ fingerprint: string; messageId: string } | null>(null);
  const latest = useRef(settings);
  latest.current = settings;
  const activateScope = useCallback(
    (next: ReviewScope) => setScope((current) => (current?.scope === next.scope ? current : next)),
    [],
  );
  const all = settings.status === "ready" ? settings.values.comments : [];
  const comments = all.filter(
    (comment) => comment.session === session && comment.scope === scope?.scope,
  );
  async function write(update: (comments: ReviewComment[]) => ReviewComment[]) {
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
  }
  async function send(agentId: string) {
    if (!scope || !comments.length || busy) return;
    setBusy(true);
    setStatus(null);
    const captured = comments;
    const fingerprint = JSON.stringify([agentId, scope, captured]);
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = {
        fingerprint,
        messageId: `git-review-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    try {
      await paseo.agents.ref(agentId).send("Please address this code review.", {
        attachments: [reviewAttachment(scope, captured)],
        messageId: pending.current.messageId,
        activeTurnBehavior: "steer",
      });
      const saved = await write((current) =>
        current.filter(
          (comment) =>
            !captured.some((sent) => sent.id === comment.id && sent.body === comment.body),
        ),
      );
      setRecipients(null);
      setStatus(saved ? "反馈已发送" : "反馈已发送，评论草稿未清理；请刷新后检查。");
      if (saved) pending.current = null;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function chooseRecipient() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const found: { id: string; title: string }[] = [];
      let cursor: string | undefined;
      do {
        const result = await paseo.agents.list({
          filter: { includeArchived: false },
          page: { limit: 100, cursor },
        });
        for (const { agent } of result.entries)
          if (workspaceId ? agent.workspaceId === workspaceId : agent.cwd === directory)
            found.push({ id: agent.id, title: agent.title || agent.id });
        cursor = result.pageInfo.hasMore ? (result.pageInfo.nextCursor ?? undefined) : undefined;
      } while (cursor);
      setRecipients(found);
      if (!found.length) setStatus("此工作区没有可接收反馈的对话。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ReviewContext.Provider
      value={{
        comments: all.filter((comment) => comment.session === session),
        setScope: activateScope,
        save: (comment) =>
          write((current) => [...current.filter((item) => item.id !== comment.id), comment]),
        remove: (ids) => write((current) => current.filter((comment) => !ids.includes(comment.id))),
      }}
    >
      <View style={{ flex: 1, minHeight: 0 }}>
        {children}
        {comments.length || status || settings.saveError ? (
          <View
            testID="review-feedback"
            style={{
              padding: 6,
              gap: 4,
              borderTopWidth: 1,
              borderColor: c.border,
              backgroundColor: c.surface1,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ flex: 1, color: c.foregroundMuted, fontSize: 12 }}>
                {comments.length} 条 Review 评论
              </Text>
              <ToolButton
                theme={theme}
                icon="check"
                text="发送反馈"
                label="发送 Review 反馈"
                busy={busy}
                disabled={!comments.length || settings.saving}
                onPress={() => void chooseRecipient()}
              />
            </View>
            {status || settings.saveError ? (
              <Text accessibilityRole="alert" style={{ color: c.foregroundMuted, fontSize: 12 }}>
                {status ?? settings.saveError}
              </Text>
            ) : null}
          </View>
        ) : null}
        {recipients?.length ? (
          <Modal transparent onRequestClose={() => setRecipients(null)}>
            <View
              style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: "#00000066",
                padding: 20,
              }}
            >
              <View
                style={{
                  width: "100%",
                  maxWidth: 440,
                  padding: 16,
                  gap: 10,
                  backgroundColor: c.surface0,
                }}
              >
                <Text style={{ color: c.foreground }}>选择接收 Review 反馈的对话</Text>
                {status ? (
                  <Text accessibilityRole="alert" style={{ color: c.statusDanger }}>
                    {status}
                  </Text>
                ) : null}
                {recipients.map((recipient) => (
                  <ToolButton
                    key={recipient.id}
                    theme={theme}
                    text={recipient.title}
                    label={`发送反馈到 ${recipient.title}`}
                    disabled={busy}
                    onPress={() => void send(recipient.id)}
                  />
                ))}
                <ToolButton
                  theme={theme}
                  text="取消"
                  label="取消发送反馈"
                  disabled={busy}
                  onPress={() => setRecipients(null)}
                />
              </View>
            </View>
          </Modal>
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
  const setScope = review?.setScope;
  useEffect(() => {
    if (setScope) setScope(scope);
  }, [setScope, scope]);
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
    const saved = await review.save({ ...target, body: body.trim() });
    setBusy(false);
    if (saved) setTarget(null);
    else setError("保存失败，请重试；评论内容已保留。");
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
                      void review.remove([target.id]).then((saved) => {
                        setBusy(false);
                        if (saved) setTarget(null);
                        else setError("删除失败，请重试。");
                      });
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
