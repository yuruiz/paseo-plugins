import { useComposers } from "@getpaseo/plugin/client";
import { useEffect, useRef } from "react";
import type { ReviewComment } from "../shared/review-comments";
import { reviewCommentSource } from "../shared/review-comments";
import { reviewComposerItem } from "./review-comments-model";

export function ReviewComposerSync({
  agentId,
  comments,
  onRemove,
  onError,
  retry,
}: {
  agentId: string;
  comments: ReviewComment[];
  onRemove(ids: string[]): Promise<boolean>;
  onError(message: string): void;
  retry: number;
}) {
  const [composer] = useComposers({ agentId });
  const seen = useRef(new Set<string>());
  const removing = useRef(false);
  const pending = useRef(new Set<string>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry reruns failed composer operations.
  useEffect(() => {
    if (!composer) return;
    const owned = composer.attachments.filter((item) => item.sourceId === reviewCommentSource.id);
    const removed = comments
      .filter(
        (comment) =>
          seen.current.has(comment.id) &&
          !pending.current.has(comment.id) &&
          !owned.some((item) => item.item.id === comment.id),
      )
      .map((comment) => comment.id);
    if (removed.length) {
      if (!removing.current) {
        removing.current = true;
        void onRemove(removed)
          .then((saved) => {
            if (!saved) onError("评论同步失败，草稿已保留，请重试。");
          })
          .catch((error) => onError(error instanceof Error ? error.message : String(error)))
          .finally(() => {
            removing.current = false;
          });
      }
      return;
    }
    try {
      for (const item of owned) {
        if (
          seen.current.has(item.item.id) &&
          !comments.some((comment) => comment.id === item.item.id)
        )
          composer.removeAttachment({ sourceId: reviewCommentSource.id, itemId: item.item.id });
      }
      for (const comment of comments) {
        const item = reviewComposerItem(comment);
        const existing = owned.find((attachment) => attachment.item.id === item.id);
        if (existing?.item.text === item.text) continue;
        pending.current.add(item.id);
        if (existing)
          composer.removeAttachment({ sourceId: reviewCommentSource.id, itemId: item.id });
        composer.addAttachment({ sourceId: reviewCommentSource.id, item });
        pending.current.delete(item.id);
      }
      seen.current = new Set(comments.map((comment) => comment.id));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }, [composer, comments, onRemove, onError, retry]);
  return null;
}
