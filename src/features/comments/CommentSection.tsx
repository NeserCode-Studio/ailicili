import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, LoaderCircle, MessageCircle, Reply, Send } from "lucide-react";
import { Link } from "react-router";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n, useToast } from "@/composables";
import {
  biliKeys,
  fetchAuthStatus,
  fetchComments,
  normalizeBiliError,
  postComment,
} from "@/lib/bili";
import { formatCompactCount, formatPublishedAt } from "@/lib/format";
import type { CommentEmote, CommentItem } from "@/shared/bili.types";
import { cn } from "@/lib/utils";

interface CommentSectionProps {
  aid: number;
  totalHint: number;
}

const COMMENT_EMOTE_SIZE = 24;

function RichMessage({
  message,
  emotes,
}: {
  message: string;
  emotes: CommentEmote[];
}) {
  const keys = new Set(emotes.map((emote) => emote.key));
  const pattern = emotes
    .map((emote) => emote.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const parts = pattern
    ? message.split(new RegExp(`(${pattern})`, "g"))
    : [message];

  return (
    <p className="text-sm leading-6 break-words whitespace-pre-wrap">
      {parts.map((part, index) => {
        const emote = keys.has(part)
          ? emotes.find((item) => item.key === part)
          : undefined;
        return emote ? (
          <img
            key={`${part}-${index}`}
            src={emote.url}
            alt={part}
            width={COMMENT_EMOTE_SIZE}
            height={COMMENT_EMOTE_SIZE}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="mx-0.5 inline-block object-contain align-text-bottom"
          />
        ) : (
          <span key={`text-${index}`}>{part}</span>
        );
      })}
    </p>
  );
}

function ReplyEditor({
  aid,
  rootId,
  parentId,
  authorName,
  onClose,
}: {
  aid: number;
  rootId: string;
  parentId: string;
  authorName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { error: toastError, success } = useToast();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const replyMutation = useMutation({
    mutationFn: (submitted: string) =>
      postComment({
        aid,
        message: submitted,
        root: Number(rootId),
        parent: Number(parentId),
      }),
    onSuccess: (_id, submitted) => {
      setMessage((current) => (current === submitted ? "" : current));
      onClose();
      success("Comments.replySent");
      void queryClient.invalidateQueries({
        queryKey: [...biliKeys.all, "comments", aid],
      });
    },
    onError: () => toastError("Comments.replyError"),
  });

  return (
    <form
      className="border-border/80 bg-muted/20 mt-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const submitted = message.trim();
        if (!submitted || replyMutation.isPending) return;
        replyMutation.mutate(submitted);
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">
          {t("Comments.replyingTo", { name: authorName })}
        </span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground text-xs"
          onClick={onClose}
        >
          {t("Common.cancel")}
        </button>
      </div>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.currentTarget.value)}
        maxLength={1000}
        rows={3}
        autoFocus
        placeholder={t("Comments.replyPlaceholder")}
        className="placeholder:text-muted-foreground/60 w-full resize-none bg-transparent text-sm leading-6 outline-none"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-muted-foreground text-[11px] tabular-nums">
          {message.length}/1000
        </span>
        <Button
          type="submit"
          size="sm"
          disabled={!message.trim() || replyMutation.isPending}
        >
          {replyMutation.isPending ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Send />
          )}
          {t("Comments.reply")}
        </Button>
      </div>
    </form>
  );
}

function CommentRow({
  aid,
  rootId,
  comment,
  lang,
  canReply,
  nested = false,
}: {
  aid: number;
  rootId: string;
  comment: CommentItem;
  lang: string;
  canReply: boolean;
  nested?: boolean;
}) {
  const { t } = useI18n();
  const [replyOpen, setReplyOpen] = useState(false);
  const replyAction = canReply ? (
    <button
      type="button"
      className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
      aria-expanded={replyOpen}
      onClick={() => setReplyOpen((value) => !value)}
    >
      <Reply className="size-3" />
      {t("Comments.reply")}
    </button>
  ) : (
    <Link
      to="/login"
      className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
    >
      <Reply className="size-3" />
      {t("Comments.reply")}
    </Link>
  );

  return (
    <article className={cn("flex gap-3 py-4", nested && "py-3")}>
      <Link to={`/space/${comment.author.mid}`} className="shrink-0">
        <span
          className={cn(
            "bg-muted flex items-center justify-center overflow-hidden rounded-full text-xs font-semibold",
            nested ? "size-7" : "size-9"
          )}
        >
          {comment.author.avatarUrl ? (
            <img
              src={comment.author.avatarUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            comment.author.name.slice(0, 1)
          )}
        </span>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link
            to={`/space/${comment.author.mid}`}
            className="text-muted-foreground text-xs font-medium hover:underline"
          >
            {comment.author.name}
          </Link>
          <span className="text-muted-foreground/70 text-[11px]">
            {formatPublishedAt(comment.createdAt, lang)}
          </span>
        </div>
        <RichMessage message={comment.message} emotes={comment.emotes} />
        <div className="text-muted-foreground mt-1.5 flex items-center gap-4 text-[11px]">
          <span className="inline-flex items-center gap-1">
            <Heart className="size-3" />
            {formatCompactCount(comment.likes, lang)}
          </span>
          {comment.replyCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="size-3" />
              {formatCompactCount(comment.replyCount, lang)}
            </span>
          )}
          {replyAction}
        </div>

        {replyOpen && canReply && (
          <ReplyEditor
            aid={aid}
            rootId={rootId}
            parentId={comment.id}
            authorName={comment.author.name}
            onClose={() => setReplyOpen(false)}
          />
        )}

        {comment.replies.length > 0 && (
          <div className="border-border/70 mt-2 border-l pl-4">
            {comment.replies.map((reply) => (
              <CommentRow
                key={reply.id}
                aid={aid}
                rootId={rootId}
                comment={reply}
                lang={lang}
                canReply={canReply}
                nested
              />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export default function CommentSection({
  aid,
  totalHint,
}: CommentSectionProps) {
  const { lang, t } = useI18n();
  const { error: toastError, success } = useToast();
  const queryClient = useQueryClient();
  const [sort, setSort] = useState<"hot" | "time">("hot");
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");

  const authQuery = useQuery({
    queryKey: biliKeys.auth(),
    queryFn: fetchAuthStatus,
    staleTime: 30_000,
  });
  const commentsQuery = useQuery({
    queryKey: biliKeys.comments(aid, page, sort),
    queryFn: () => fetchComments(aid, page, sort),
    enabled: aid > 0,
    staleTime: 30_000,
  });
  const postMutation = useMutation({
    mutationFn: (submitted: string) => postComment({ aid, message: submitted }),
    onSuccess: (_id, submitted) => {
      setMessage((current) => (current === submitted ? "" : current));
      success("Comments.sent");
      void queryClient.invalidateQueries({
        queryKey: biliKeys.comments(aid, page, sort),
      });
    },
    onError: () => toastError("Comments.error"),
  });

  const total = commentsQuery.data?.total ?? totalHint;

  return (
    <section aria-labelledby="comments-heading" className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="comments-heading" className="text-base font-semibold">
          {t("Comments.title")}{" "}
          <span className="text-muted-foreground font-normal tabular-nums">
            {formatCompactCount(total, lang)}
          </span>
        </h2>
        <div className="border-border inline-flex rounded-md border p-0.5">
          {(["hot", "time"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setSort(value);
                setPage(1);
              }}
              className={cn(
                "rounded-sm px-3 py-1 text-xs transition-colors",
                sort === value
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t(value === "hot" ? "Comments.hot" : "Comments.time")}
            </button>
          ))}
        </div>
      </div>

      {authQuery.data?.authenticated ? (
        <div className="border-border/80 bg-muted/20 mb-2 rounded-md border p-3">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.currentTarget.value)}
            maxLength={1000}
            rows={3}
            placeholder={t("Comments.placeholder")}
            className="placeholder:text-muted-foreground/60 w-full resize-none bg-transparent text-sm leading-6 outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-muted-foreground text-[11px] tabular-nums">
              {message.length}/1000
            </span>
            <Button
              type="button"
              size="sm"
              disabled={!message.trim() || postMutation.isPending}
              onClick={() => postMutation.mutate(message.trim())}
            >
              {postMutation.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Send />
              )}
              {t("Comments.send")}
            </Button>
          </div>
        </div>
      ) : (
        <Link
          to="/login"
          className="border-border/80 text-muted-foreground hover:border-primary/50 hover:text-foreground mb-2 flex items-center justify-center rounded-md border border-dashed py-4 text-sm transition-colors"
        >
          {t("Comments.login")}
        </Link>
      )}

      {commentsQuery.isPending ? (
        <div className="space-y-4 py-4" data-testid="comments-loading">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : commentsQuery.error ? (
        <AsyncErrorState
          title={t("Comments.loadError.title")}
          description={t("Comments.loadError.description")}
          code={normalizeBiliError(commentsQuery.error).code}
          retryLabel={t("Comments.retry")}
          onRetry={() => void commentsQuery.refetch()}
        />
      ) : commentsQuery.data?.comments.length ? (
        <>
          <div className="divide-border/70 divide-y">
            {commentsQuery.data.comments.map((comment) => (
              <CommentRow
                key={comment.id}
                aid={aid}
                rootId={comment.id}
                comment={comment}
                lang={lang}
                canReply={Boolean(authQuery.data?.authenticated)}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1 || commentsQuery.isFetching}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              {t("Common.previous")}
            </Button>
            <span className="text-muted-foreground text-xs tabular-nums">
              {page}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!commentsQuery.data.hasMore || commentsQuery.isFetching}
              onClick={() => setPage((value) => value + 1)}
            >
              {t("Common.next")}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {t("Comments.empty")}
        </p>
      )}
    </section>
  );
}
