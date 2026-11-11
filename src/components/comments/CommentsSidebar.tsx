import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  ImageOff,
  Info,
  Loader2,
  Maximize2,
  MessageCircle,
  RefreshCw,
  ThumbsUp,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Lightbox from "yet-another-react-lightbox";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";

import { asCommandError, type CommandError } from "@/api/account";
import {
  getCommentReplies,
  getVideoComments,
  type CommentEmote,
  type CommentSort,
  type CommentPicture,
  type VideoComment,
} from "@/api/comments";
import { Tooltip } from "@/components/framework/Tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/composables";
import { useAccount } from "@/contexts/account-context";
import { commandErrorMessage } from "@/lib/command-error";
import { formatCount, formatTimestamp } from "@/lib/format";
import { useRemoteImage, useRemoteImages } from "@/hooks/useRemoteImages";
import { createLogger } from "@/lib/logger";
import { cn } from "@/lib/utils";

const log = createLogger("Comments/Sidebar");
const SINGLE_IMAGE_PLUGINS = [Zoom];
const GALLERY_IMAGE_PLUGINS = [Zoom, Counter, Thumbnails];
const COMMENT_LIGHTBOX_RENDER = {
  iconPrev: () => <ChevronLeft className="yarl__icon" aria-hidden="true" />,
  iconNext: () => <ChevronRight className="yarl__icon" aria-hidden="true" />,
  iconClose: () => <X className="yarl__icon" aria-hidden="true" />,
  iconZoomIn: () => <ZoomIn className="yarl__icon" aria-hidden="true" />,
  iconZoomOut: () => <ZoomOut className="yarl__icon" aria-hidden="true" />,
};
const CommentLightboxContext = createContext<((open: boolean) => void) | null>(
  null
);

interface CommentsSidebarProps {
  aid: number;
  open: boolean;
  onClose: () => void;
  onLogin: () => void;
}

function mergeComments(
  current: VideoComment[],
  incoming: VideoComment[]
): VideoComment[] {
  const seen = new Set(current.map((comment) => comment.id));
  return [
    ...current,
    ...incoming.filter((comment) => {
      if (seen.has(comment.id)) return false;
      seen.add(comment.id);
      return true;
    }),
  ];
}

function commentDate(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

function commentLocation(location?: string) {
  const value = location?.trim();
  if (!value) return null;
  return value.replace(/^IP属地\s*[：:]\s*/u, "") || null;
}

function commentPictureThumbnail(source: string) {
  try {
    const url = new URL(source);
    if (!url.pathname.includes("@")) {
      url.pathname = `${url.pathname}@320w_320h_1c.webp`;
    }
    return url.toString();
  } catch {
    return source;
  }
}

function CommentPictures({
  pictures,
  authorName,
}: {
  pictures: CommentPicture[];
  authorName: string;
}) {
  const { t } = useI18n();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [requestedIndex, setRequestedIndex] = useState(-1);
  const setLightboxOpen = useContext(CommentLightboxContext);
  const lightboxOpen = activeIndex >= 0;
  const fullImagesRequested = requestedIndex >= 0 || lightboxOpen;
  const thumbnailSources = pictures.map((picture) =>
    commentPictureThumbnail(picture.url)
  );
  const fullSources = pictures.map((picture) => picture.url);
  const { resolvedSources: thumbnailUrls, failedSources: failedThumbnails } =
    useRemoteImages(thumbnailSources);
  const { resolvedSources: fullUrls, failedSources: failedFullImages } =
    useRemoteImages(fullSources, {
      enabled: fullImagesRequested,
    });
  const fullImagesSettled = pictures.every(
    (picture) =>
      Boolean(fullUrls[picture.url]) || failedFullImages.has(picture.url)
  );

  useEffect(() => {
    if (!lightboxOpen || !setLightboxOpen) return;
    setLightboxOpen(true);
    return () => setLightboxOpen(false);
  }, [lightboxOpen, setLightboxOpen]);

  useEffect(() => {
    if (requestedIndex < 0 || !fullImagesSettled) return;
    setActiveIndex(requestedIndex);
    setRequestedIndex(-1);
  }, [fullImagesSettled, requestedIndex]);

  if (pictures.length === 0) return null;

  const slides = pictures.map((picture, index) => ({
    src:
      fullUrls[picture.url] ??
      (failedFullImages.has(picture.url)
        ? thumbnailUrls[thumbnailSources[index]]
        : undefined) ??
      picture.url,
    thumbnail:
      thumbnailUrls[thumbnailSources[index]] ??
      fullUrls[picture.url] ??
      picture.url,
    width: picture.width,
    height: picture.height,
    alt: t("Comments.image.alt")
      .replace("{author}", authorName)
      .replace("{index}", String(index + 1))
      .replace("{count}", String(pictures.length)),
  }));

  return (
    <>
      <div
        className={cn(
          "mt-2 grid max-w-sm gap-2",
          pictures.length === 1 ? "grid-cols-1" : "grid-cols-2"
        )}
      >
        {pictures.map((picture, index) => {
          const wideLast =
            pictures.length > 1 &&
            pictures.length % 2 === 1 &&
            index === pictures.length - 1;
          const thumbnailUrl = thumbnailUrls[thumbnailSources[index]];
          const thumbnailFailed = failedThumbnails.has(thumbnailSources[index]);
          const opening = requestedIndex === index;
          return (
            <button
              key={`${picture.url}:${index}`}
              type="button"
              aria-busy={opening}
              aria-label={t("Comments.image.open")
                .replace("{index}", String(index + 1))
                .replace("{count}", String(pictures.length))}
              className={cn(
                "group bg-muted border-border focus-visible:ring-ring relative overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default",
                pictures.length === 1 && "h-28 w-40",
                pictures.length > 1 && !wideLast && "aspect-square w-full",
                wideLast && "col-span-2 aspect-[2/1] w-full"
              )}
              disabled={!thumbnailUrl}
              title={
                thumbnailFailed ? t("Comments.image.unavailable") : undefined
              }
              onClick={() => {
                if (thumbnailUrl) setRequestedIndex(index);
              }}
            >
              {thumbnailUrl ? (
                <>
                  <img
                    src={thumbnailUrl}
                    alt=""
                    width={picture.width}
                    height={picture.height}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                  <span
                    className={cn(
                      "absolute inset-0 grid place-items-center text-white transition-[background-color,opacity] duration-150",
                      opening
                        ? "bg-black/25 opacity-100"
                        : "bg-black/0 opacity-0 group-hover:bg-black/25 group-hover:opacity-100 group-focus-visible:bg-black/25 group-focus-visible:opacity-100"
                    )}
                  >
                    {opening ? (
                      <Loader2
                        className="size-5 animate-spin drop-shadow"
                        aria-hidden="true"
                      />
                    ) : (
                      <Maximize2
                        className="size-5 drop-shadow"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </>
              ) : thumbnailFailed ? (
                <span className="text-muted-foreground grid size-full place-items-center">
                  <ImageOff className="size-4" aria-hidden="true" />
                  <span className="sr-only">
                    {t("Comments.image.unavailable")}
                  </span>
                </span>
              ) : (
                <Skeleton className="size-full rounded-none" />
              )}
              {pictures.length > 1 && thumbnailUrl ? (
                <span className="absolute right-1.5 bottom-1.5 rounded-sm bg-black/65 px-1.5 py-0.5 text-[10px] leading-4 font-medium text-white tabular-nums">
                  {index + 1}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <Lightbox
        open={activeIndex >= 0}
        close={() => setActiveIndex(-1)}
        index={Math.max(activeIndex, 0)}
        slides={slides}
        plugins={
          pictures.length > 1 ? GALLERY_IMAGE_PLUGINS : SINGLE_IMAGE_PLUGINS
        }
        render={COMMENT_LIGHTBOX_RENDER}
        carousel={{ finite: true, padding: "5%", spacing: "14%" }}
        controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
        animation={{
          fade: 220,
          swipe: 280,
          navigation: 240,
          zoom: 240,
          easing: {
            fade: "cubic-bezier(0.22, 1, 0.36, 1)",
            swipe: "cubic-bezier(0.22, 1, 0.36, 1)",
            navigation: "cubic-bezier(0.22, 1, 0.36, 1)",
          },
        }}
        zoom={{ maxZoomPixelRatio: 4, scrollToZoom: true }}
        counter={
          pictures.length > 1
            ? {
                separator: "/",
              }
            : undefined
        }
        thumbnails={
          pictures.length > 1
            ? {
                position: "bottom",
                width: 48,
                height: 36,
                border: 1,
                borderStyle: "solid",
                borderRadius: 6,
                padding: 2,
                gap: 8,
                imageFit: "cover",
                vignette: false,
                showToggle: false,
              }
            : undefined
        }
        labels={{
          Close: t("Comments.image.close"),
          Next: t("Comments.image.next"),
          Previous: t("Comments.image.previous"),
          Lightbox: t("Comments.image.gallery"),
          Carousel: t("Comments.image.gallery"),
          "Photo gallery": t("Comments.image.gallery"),
          Slide: t("Comments.image.slide"),
          "{index} of {total}": t("Comments.image.position"),
          "Zoom in": t("Comments.image.zoomIn"),
          "Zoom out": t("Comments.image.zoomOut"),
          Thumbnails: t("Comments.image.thumbnails"),
        }}
        portal={{
          root: () => document.getElementById("container"),
          container: {
            className: "comment-lightbox",
            style: {
              position: "absolute",
              inset: 0,
            },
          },
        }}
      />
    </>
  );
}

function CommentAvatar({
  source,
  authorName,
  compact,
}: {
  source?: string;
  authorName: string;
  compact: boolean;
}) {
  const { src } = useRemoteImage(source);

  return (
    <Avatar className={compact ? "size-6" : "size-8"}>
      {src ? <AvatarImage src={src} alt="" className="object-cover" /> : null}
      <AvatarFallback
        delayMs={source ? 200 : 0}
        className="bg-muted text-muted-foreground text-[10px]"
      >
        {Array.from(authorName)[0]?.toUpperCase() ?? "?"}
      </AvatarFallback>
    </Avatar>
  );
}

function CommentEmoteImage({
  emote,
  compact,
}: {
  emote: CommentEmote;
  compact: boolean;
}) {
  const { src, failed } = useRemoteImage(emote.url);

  if (failed) return <span>{emote.text}</span>;

  return (
    <span
      role="img"
      aria-label={emote.text}
      title={emote.text}
      className={cn(
        "mx-0.5 inline-flex shrink-0 items-center justify-center overflow-hidden align-middle",
        compact ? "h-5 max-w-8 min-w-5" : "h-6 max-w-10 min-w-6"
      )}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-auto max-w-full object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "bg-muted animate-pulse rounded-sm",
            compact ? "size-5" : "size-6"
          )}
        />
      )}
    </span>
  );
}

function CommentMessage({
  message,
  emotes,
  compact,
}: {
  message: string;
  emotes: CommentEmote[];
  compact: boolean;
}) {
  const sortedEmotes = emotes
    .filter((emote) => emote.text.length > 0)
    .sort((left, right) => right.text.length - left.text.length);
  if (sortedEmotes.length === 0) return message;

  const parts: ReactNode[] = [];
  let cursor = 0;
  let textStart = 0;
  let emoteIndex = 0;

  while (cursor < message.length) {
    const emote = sortedEmotes.find((item) =>
      message.startsWith(item.text, cursor)
    );
    if (!emote) {
      cursor += 1;
      continue;
    }
    if (textStart < cursor) {
      parts.push(message.slice(textStart, cursor));
    }
    parts.push(
      <CommentEmoteImage
        key={`${emote.text}:${emoteIndex}`}
        emote={emote}
        compact={compact}
      />
    );
    emoteIndex += 1;
    cursor += emote.text.length;
    textStart = cursor;
  }

  if (textStart < message.length) {
    parts.push(message.slice(textStart));
  }
  return parts.length > 0 ? parts : message;
}

function CommentContent({
  comment,
  compact = false,
  actions,
  children,
}: {
  comment: VideoComment;
  compact?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const { lang, t } = useI18n();
  const authorName = comment.author.name.trim() || t("Comments.anonymous");
  const pictures = comment.pictures ?? [];
  const message =
    comment.message.trim() ||
    (pictures.length === 0 ? t("Comments.contentUnavailable") : "");
  const createdAt = commentDate(comment.createdAt);
  const location = commentLocation(comment.location);

  return (
    <div className="flex min-w-0 gap-3">
      <div
        className={cn("flex shrink-0 items-start", compact ? "w-6" : "w-10")}
      >
        <CommentAvatar
          source={comment.author.avatarUrl}
          authorName={authorName}
          compact={compact}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-foreground min-w-0 text-xs font-semibold break-words">
              {authorName}
            </span>
            {comment.author.isUp ? (
              <span className="rounded-sm bg-[var(--player-accent)]/20 px-1 text-[10px] leading-4 font-semibold text-[var(--player-accent)]">
                {t("Comments.up")}
              </span>
            ) : null}
            {comment.isPinned ? (
              <span className="text-muted-foreground text-[10px] leading-4">
                {t("Comments.pinned")}
              </span>
            ) : null}
            {location ? (
              <span className="inline-flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="bg-border h-3 w-px shrink-0"
                />
                <Tooltip content={`${t("Comments.location")}: ${location}`}>
                  <span
                    tabIndex={0}
                    aria-label={comment.location}
                    className="text-muted-foreground focus-visible:ring-ring min-w-0 cursor-help truncate rounded-sm text-[10px] leading-4 focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {location}
                  </span>
                </Tooltip>
              </span>
            ) : null}
          </div>
          {createdAt ? (
            <time
              dateTime={createdAt.toISOString()}
              className="text-muted-foreground shrink-0 pt-0.5 text-[10px] leading-4 tabular-nums"
            >
              {formatTimestamp(comment.createdAt, lang)}
            </time>
          ) : null}
        </div>

        {message ? (
          <p
            className={cn(
              "text-foreground/75 mt-1.5 [overflow-wrap:anywhere] whitespace-pre-wrap",
              compact ? "text-xs leading-5" : "text-sm leading-6"
            )}
          >
            <CommentMessage
              message={message}
              emotes={comment.emotes ?? []}
              compact={compact}
            />
          </p>
        ) : null}

        <CommentPictures pictures={pictures} authorName={authorName} />

        <div
          className={cn(
            "mt-2 flex min-w-0 items-center gap-3",
            actions ? "justify-between" : "justify-end"
          )}
        >
          {actions ? <div className="min-w-0 flex-1">{actions}</div> : null}
          <span className="text-muted-foreground ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] leading-4 tabular-nums">
            <ThumbsUp className="size-3 shrink-0" aria-hidden="true" />
            {formatCount(comment.likeCount)}
          </span>
        </div>

        {children ? <div className="mt-2 min-w-0">{children}</div> : null}
      </div>
    </div>
  );
}

function InlineError({
  error,
  onRetry,
  className,
}: {
  error: CommandError;
  onRetry: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "text-destructive flex items-start gap-2 text-xs leading-5",
        className
      )}
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p>{commandErrorMessage(error, t)}</p>
        <button
          type="button"
          className="text-foreground hover:text-foreground/75 focus-visible:ring-ring mt-1 font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
          onClick={onRetry}
        >
          {t("Comments.retry")}
        </button>
      </div>
    </div>
  );
}

class CommentListBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
    resetKey: string;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error("comment list render failed", {
      error,
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function CommentThread({
  aid,
  comment,
  canLoadMore,
}: {
  aid: number;
  comment: VideoComment;
  canLoadMore: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [replies, setReplies] = useState(comment.replies ?? []);
  const [loadedPage, setLoadedPage] = useState(0);
  const [nextPage, setNextPage] = useState<number>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);
  const [failedPage, setFailedPage] = useState<number | null>(null);
  const repliesRef = useRef(comment.replies ?? []);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const replyCount = Math.max(comment.replyCount, replies.length);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const loadPage = async (page: number) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setFailedPage(null);
    try {
      const result = await getCommentReplies(aid, comment.id, page);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const currentReplies = repliesRef.current;
      const nextReplies =
        page === 1 ? result.items : mergeComments(currentReplies, result.items);
      const addedCount =
        page === 1
          ? nextReplies.length
          : nextReplies.length - currentReplies.length;
      const hasKnownRemainder =
        addedCount > 0 && nextReplies.length < replyCount;
      const hasNextPage = result.hasMore || hasKnownRemainder;
      repliesRef.current = nextReplies;
      setReplies(nextReplies);
      setLoadedPage(page);
      setHasMore(hasNextPage);
      setNextPage(hasNextPage ? (result.nextPage ?? page + 1) : undefined);
    } catch (reason) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError(asCommandError(reason));
      setFailedPage(page);
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  };

  const toggleExpanded = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (loadedPage === 0 && replyCount > replies.length && !loading) {
      void loadPage(1);
    }
  };

  const replyAction =
    replyCount > 0 ? (
      <button
        type="button"
        aria-expanded={expanded}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex h-7 items-center gap-1 rounded-sm px-1 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
        onClick={toggleExpanded}
      >
        {expanded ? (
          <ChevronUp className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-3.5" aria-hidden="true" />
        )}
        {expanded
          ? t("Comments.replies.hide")
          : t("Comments.replies.show").replace(
              "{count}",
              formatCount(replyCount)
            )}
      </button>
    ) : undefined;

  return (
    <CommentContent comment={comment} actions={replyAction}>
      {expanded ? (
        <div className="border-border space-y-3 border-l pl-3">
          {replies.map((reply) => (
            <CommentContent key={reply.id} comment={reply} compact />
          ))}

          {loading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {t("Comments.replies.loading")}
            </div>
          ) : null}

          {error ? (
            <InlineError
              error={error}
              onRetry={() => void loadPage(failedPage ?? 1)}
            />
          ) : null}

          {!loading && !error && replies.length === 0 ? (
            <p className="text-muted-foreground text-[11px]">
              {t("Comments.replies.none")}
            </p>
          ) : null}

          {!loading && !error && hasMore && canLoadMore ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring text-[11px] font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
              onClick={() => void loadPage(nextPage ?? loadedPage + 1)}
            >
              {t("Comments.replies.loadMore")}
            </button>
          ) : null}

          {!loading && !error && !hasMore && replies.length > 0 ? (
            <p className="text-muted-foreground/75 text-[11px]">
              {t("Comments.replies.end")}
            </p>
          ) : null}
        </div>
      ) : null}
    </CommentContent>
  );
}

function CommentSkeleton() {
  return (
    <div className="border-border space-y-2 border-b py-4">
      <div className="flex gap-3">
        <div className="flex w-8 shrink-0 items-start">
          <Skeleton className="bg-muted size-8 rounded-full" />
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="bg-muted h-3 w-24" />
            <Skeleton className="bg-muted h-2.5 w-16" />
          </div>
          <Skeleton className="bg-muted h-3 w-full" />
          <Skeleton className="bg-muted h-3 w-4/5" />
          <Skeleton className="bg-muted ml-auto h-2.5 w-24" />
        </div>
      </div>
    </div>
  );
}

function SidebarState({
  icon,
  title,
  action,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="bg-muted text-muted-foreground grid size-10 place-items-center rounded-full">
        {icon}
      </div>
      <p className="text-muted-foreground text-sm">{title}</p>
      {action}
    </div>
  );
}

function CommentsLoginHint({ onLogin }: { onLogin: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="note"
      className="border-border bg-muted/75 text-muted-foreground mx-4 mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs backdrop-blur-md"
    >
      <Info
        className="text-foreground/70 size-3.5 shrink-0"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 leading-5">
        {t("Comments.loginForMore")}
      </span>
      <button
        type="button"
        className="text-foreground hover:text-foreground/75 focus-visible:ring-ring shrink-0 font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
        onClick={onLogin}
      >
        {t("Account.titlebar.login")}
      </button>
    </div>
  );
}

const commentsSidebarSurfaceClass = (open: boolean) =>
  cn(
    "border-border bg-background/80 text-foreground absolute inset-y-0 right-0 z-50 overflow-hidden shadow-2xl backdrop-blur-[40px] backdrop-saturate-150 transition-[width,background-color,border-color,color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none",
    open
      ? "w-full border-l sm:w-[360px] lg:w-[384px]"
      : "pointer-events-none w-0 border-l-0"
  );

const commentsSidebarContentClass =
  "flex h-full w-screen shrink-0 flex-col sm:w-[360px] lg:w-[384px]";

const commentsSidebarBackdropClass = (open: boolean) =>
  cn(
    "bg-background/20 absolute inset-0 z-40 backdrop-blur-[2px] transition-opacity duration-300 ease-out motion-reduce:transition-none",
    open ? "opacity-100" : "pointer-events-none opacity-0"
  );

interface CommentsSidebarBoundaryProps extends CommentsSidebarProps {
  title: string;
  closeLabel: string;
  fallbackTitle: string;
  retryLabel: string;
  children: ReactNode;
}

class CommentsSidebarBoundary extends Component<
  CommentsSidebarBoundaryProps,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error("comments sidebar render failed", {
      error,
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(previous: Readonly<CommentsSidebarBoundaryProps>) {
    if (previous.aid !== this.props.aid && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  private retry = () => {
    this.setState({ failed: false });
  };

  render() {
    const { children, fallbackTitle, onClose, open, retryLabel, title } =
      this.props;
    if (!this.state.failed) return children;

    return (
      <>
        <button
          type="button"
          aria-label={this.props.closeLabel}
          aria-hidden={!open}
          tabIndex={-1}
          className={commentsSidebarBackdropClass(open)}
          onClick={onClose}
        />
        <aside
          aria-label={title}
          aria-hidden={!open}
          inert={!open}
          className={commentsSidebarSurfaceClass(open)}
        >
          <div className={commentsSidebarContentClass}>
            <header className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-3">
              <h2 className="text-sm font-semibold">{title}</h2>
              <button
                type="button"
                aria-label={this.props.closeLabel}
                title={this.props.closeLabel}
                className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring ml-auto inline-flex size-8 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                onClick={onClose}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </header>
            <SidebarState
              icon={<CircleAlert className="size-4" aria-hidden="true" />}
              title={fallbackTitle}
              action={
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={this.retry}
                >
                  <RefreshCw />
                  {retryLabel}
                </Button>
              }
            />
          </div>
        </aside>
      </>
    );
  }
}

function CommentsSidebarContent({
  aid,
  open,
  onClose,
  onLogin,
}: CommentsSidebarProps) {
  const { t } = useI18n();
  const { account, loading: accountLoading } = useAccount();
  // Anonymous comment pagination currently dead-ends after the first page.
  const canLoadMore = account?.status === "authenticated";
  const showLoginHint = !accountLoading && !canLoadMore;
  const [sort, setSort] = useState<CommentSort>("hot");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [items, setItems] = useState<VideoComment[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);
  const [paginationError, setPaginationError] = useState<CommandError | null>(
    null
  );
  const [reloadToken, setReloadToken] = useState(0);
  const loadedKeyRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !lightboxOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen, onClose, open]);

  useEffect(() => {
    if (!open) return;
    const key = `${aid}:${sort}:${reloadToken}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    const generation = ++requestGenerationRef.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setPaginationError(null);
    setItems([]);
    setTotal(0);
    setNextCursor(undefined);
    setHasMore(false);

    void getVideoComments(aid, sort)
      .then((page) => {
        if (
          !mountedRef.current ||
          generation !== requestGenerationRef.current
        ) {
          return;
        }
        setItems(page.items);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
      })
      .catch((reason) => {
        if (
          !mountedRef.current ||
          generation !== requestGenerationRef.current
        ) {
          return;
        }
        setError(asCommandError(reason));
      })
      .finally(() => {
        if (mountedRef.current && generation === requestGenerationRef.current) {
          setLoading(false);
        }
      });
  }, [aid, open, reloadToken, sort]);

  const loadMore = useCallback(async () => {
    if (!canLoadMore || !hasMore || !nextCursor || loadingMore) return;
    const generation = requestGenerationRef.current;
    setLoadingMore(true);
    setPaginationError(null);
    try {
      const page = await getVideoComments(aid, sort, nextCursor);
      if (!mountedRef.current || generation !== requestGenerationRef.current) {
        return;
      }
      setItems((current) => mergeComments(current, page.items));
      setTotal((current) => Math.max(current, page.total));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (reason) {
      if (!mountedRef.current || generation !== requestGenerationRef.current) {
        return;
      }
      setPaginationError(asCommandError(reason));
    } finally {
      if (mountedRef.current && generation === requestGenerationRef.current) {
        setLoadingMore(false);
      }
    }
  }, [aid, canLoadMore, hasMore, loadingMore, nextCursor, sort]);

  const changeSort = (nextSort: CommentSort) => {
    if (nextSort === sort) return;
    setSort(nextSort);
  };

  return (
    <>
      <button
        type="button"
        aria-label={t("Comments.close")}
        aria-hidden={!open}
        tabIndex={-1}
        className={commentsSidebarBackdropClass(open)}
        onClick={onClose}
      />
      <aside
        aria-label={t("Comments.title")}
        aria-hidden={!open}
        inert={!open}
        className={commentsSidebarSurfaceClass(open)}
      >
        <CommentLightboxContext.Provider value={setLightboxOpen}>
          <div className={commentsSidebarContentClass}>
            <header className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-3">
              <div className="flex min-w-0 items-baseline gap-2">
                <h2 className="text-sm font-semibold">{t("Comments.title")}</h2>
                {!loading && total > 0 ? (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatCount(total)}
                  </span>
                ) : null}
              </div>
              <div
                role="tablist"
                aria-label={t("Comments.sort.label")}
                className="bg-muted ml-auto grid w-28 shrink-0 grid-cols-2 rounded-md p-0.5"
              >
                {(["hot", "time"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={sort === option}
                    className={cn(
                      "focus-visible:ring-ring h-7 rounded-sm text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                      sort === option
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => changeSort(option)}
                  >
                    {t(`Comments.sort.${option}`)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label={t("Comments.close")}
                title={t("Comments.close")}
                className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring inline-flex size-8 shrink-0 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                onClick={onClose}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </header>

            {showLoginHint ? <CommentsLoginHint onLogin={onLogin} /> : null}

            <ScrollArea
              type="auto"
              className="[&_[data-slot=scroll-area-thumb]]:bg-foreground/20 min-h-0 flex-1 [&_[data-slot=scroll-area-scrollbar]]:bg-transparent [&_[data-slot=scroll-area-viewport]]:overscroll-contain"
            >
              <div className="px-4" aria-busy={loading || loadingMore}>
                {loading ? (
                  <div aria-label={t("Comments.loading")}>
                    {Array.from({ length: 4 }, (_, index) => (
                      <CommentSkeleton key={index} />
                    ))}
                  </div>
                ) : error ? (
                  <SidebarState
                    icon={<CircleAlert className="size-4" aria-hidden="true" />}
                    title={commandErrorMessage(error, t)}
                    action={
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={
                          error.code === "loginExpired" ||
                          error.code === "authRequired"
                            ? onLogin
                            : () => {
                                loadedKeyRef.current = null;
                                setReloadToken((value) => value + 1);
                              }
                        }
                      >
                        <RefreshCw />
                        {error.code === "loginExpired" ||
                        error.code === "authRequired"
                          ? t("Account.titlebar.login")
                          : t("Comments.retry")}
                      </Button>
                    }
                  />
                ) : items.length === 0 ? (
                  <SidebarState
                    icon={
                      <MessageCircle className="size-4" aria-hidden="true" />
                    }
                    title={t("Comments.empty")}
                  />
                ) : (
                  <CommentListBoundary
                    resetKey={`${sort}:${reloadToken}`}
                    fallback={
                      <SidebarState
                        icon={
                          <CircleAlert className="size-4" aria-hidden="true" />
                        }
                        title={t("Comments.renderError")}
                        action={
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              loadedKeyRef.current = null;
                              setReloadToken((value) => value + 1);
                            }}
                          >
                            <RefreshCw />
                            {t("Comments.retry")}
                          </Button>
                        }
                      />
                    }
                  >
                    <div key={`${sort}:${reloadToken}`}>
                      {items.map((comment) => (
                        <article
                          key={comment.id}
                          className="border-border border-b py-4 last:border-b-0"
                        >
                          <CommentThread
                            aid={aid}
                            comment={comment}
                            canLoadMore={canLoadMore}
                          />
                        </article>
                      ))}

                      {paginationError ? (
                        <InlineError
                          error={paginationError}
                          onRetry={() => void loadMore()}
                          className="py-4"
                        />
                      ) : null}

                      {!paginationError && hasMore && canLoadMore ? (
                        <div className="flex justify-center py-4">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            disabled={loadingMore}
                            onClick={() => void loadMore()}
                          >
                            {loadingMore ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <ChevronDown />
                            )}
                            {loadingMore
                              ? t("Comments.loadingMore")
                              : t("Comments.loadMore")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </CommentListBoundary>
                )}
              </div>
            </ScrollArea>
          </div>
        </CommentLightboxContext.Provider>
      </aside>
    </>
  );
}

export function CommentsSidebar(props: CommentsSidebarProps) {
  const { t } = useI18n();
  return (
    <CommentsSidebarBoundary
      {...props}
      title={t("Comments.title")}
      closeLabel={t("Comments.close")}
      fallbackTitle={t("Comments.renderError")}
      retryLabel={t("Comments.retry")}
    >
      <CommentsSidebarContent {...props} />
    </CommentsSidebarBoundary>
  );
}
