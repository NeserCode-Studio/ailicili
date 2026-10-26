import { useEffect, useRef, useState } from "react";
import {
  LoaderCircle,
  MessageSquareText,
  Shield,
  WifiOff,
  X,
} from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/composables";
import {
  pollLiveChat,
  startLiveChat,
  stopLiveChat,
} from "@/lib/bili";
import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LiveChatMessage } from "@/shared/bili.types";

const MAX_VISIBLE_MESSAGES = 160;
const POLL_INTERVAL_MS = 1_200;

type ChatStatus = "idle" | "connecting" | "connected" | "retrying" | "error";

interface LiveChatPanelProps {
  roomId: number;
  active: boolean;
  onClose?: () => void;
}

function mergeMessages(
  current: LiveChatMessage[],
  incoming: LiveChatMessage[]
) {
  if (incoming.length === 0) return current;
  const ids = new Set(current.map((message) => message.id));
  const merged = [...current];
  for (const message of incoming) {
    if (ids.has(message.id)) continue;
    ids.add(message.id);
    merged.push(message);
  }
  return merged.slice(-MAX_VISIBLE_MESSAGES);
}

function messageColor(color: number) {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

function messageTime(timestamp: number, lang: string) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  return formatClock(milliseconds, lang);
}

export default function LiveChatPanel({
  roomId,
  active,
  onClose,
}: LiveChatPanelProps) {
  const { lang, t } = useI18n();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const cursorRef = useRef(0);

  useEffect(() => {
    if (!active || roomId <= 0) {
      setSessionId(null);
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let acquiredSessionId: string | null = null;
    cursorRef.current = 0;
    setSessionId(null);
    setStatus("connecting");

    void startLiveChat(roomId)
      .then((session) => {
        acquiredSessionId = session.sessionId;
        if (cancelled) {
          void stopLiveChat(session.sessionId).catch(() => undefined);
          return;
        }
        setSessionId(session.sessionId);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });

    return () => {
      cancelled = true;
      if (acquiredSessionId) {
        void stopLiveChat(acquiredSessionId).catch(() => undefined);
      }
    };
  }, [active, roomId]);

  useEffect(() => {
    if (!active || !sessionId) return;

    let cancelled = false;
    let timerId: number | null = null;
    let polling = false;

    const poll = async () => {
      if (cancelled || polling) return;
      polling = true;
      try {
        const result = await pollLiveChat(sessionId, cursorRef.current);
        if (cancelled) return;
        cursorRef.current = result.cursor;
        setMessages((current) =>
          mergeMessages(current, result.messages)
        );
        if (result.connected) {
          setStatus("connected");
        } else {
          setStatus(result.error ? "retrying" : "connecting");
        }
      } catch {
        if (!cancelled) setStatus("retrying");
      } finally {
        polling = false;
        if (!cancelled) {
          timerId = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [active, sessionId]);

  return (
    <section
      data-testid="live-chat-panel"
      aria-label={t("Live.chat.title")}
      className="bg-background text-foreground flex h-full min-h-0 w-full flex-col"
    >
      <header className="border-border flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquareText className="text-muted-foreground size-4 shrink-0" />
          <h2 className="truncate text-sm font-semibold">
            {t("Live.chat.title")}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[10px]">
            <span
              className={cn(
                "size-1.5 rounded-full",
                status === "connected"
                  ? "bg-emerald-500"
                  : status === "retrying" || status === "error"
                    ? "bg-amber-500"
                    : "animate-pulse bg-zinc-500"
              )}
            />
            {t(`Live.chat.status.${status}`)}
          </span>
          {onClose && (
            <button
              type="button"
              aria-label={t("Live.chat.close")}
              title={t("Live.chat.close")}
              onClick={onClose}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 items-center justify-center rounded-md transition-colors md:hidden"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          className="space-y-2 px-3 py-3"
        >
          {messages.map((message) => {
            const time = messageTime(message.timestamp, lang);
            return (
              <article
                key={message.id}
                className="min-w-0 text-xs leading-5 [overflow-wrap:anywhere]"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold uppercase"
                  >
                    {message.username.trim().charAt(0) || "U"}
                  </span>
                  {message.medal && (
                    <span
                      title={message.medal.anchorName}
                      className="border-primary/30 bg-primary/10 text-primary max-w-28 truncate rounded-sm border px-1 text-[9px] leading-4"
                    >
                      {message.medal.name} · {message.medal.level}
                    </span>
                  )}
                  {message.guardLevel > 0 && (
                    <span className="inline-flex items-center gap-0.5 rounded-sm bg-amber-500/10 px-1 text-[9px] leading-4 text-amber-500">
                      <Shield className="size-2.5" />
                      {message.guardLevel}
                    </span>
                  )}
                  {message.isAdmin && (
                    <span className="rounded-sm bg-rose-500/10 px-1 text-[9px] leading-4 text-rose-500">
                      {t("Live.chat.admin")}
                    </span>
                  )}
                  <span className="text-muted-foreground min-w-0 truncate font-medium">
                    {message.username}
                  </span>
                  {time && (
                    <time className="text-muted-foreground/55 ml-auto shrink-0 font-mono text-[9px]">
                      {time}
                    </time>
                  )}
                </div>
                <p
                  className="mt-0.5 pl-6 text-[13px] text-zinc-200"
                  style={{
                    color: `color-mix(in srgb, ${messageColor(message.color)} 38%, var(--foreground))`,
                  }}
                >
                  {message.text}
                </p>
              </article>
            );
          })}

          {messages.length === 0 && status !== "error" && (
            <div className="text-muted-foreground flex min-h-40 flex-col items-center justify-center gap-2 text-center text-xs">
              <LoaderCircle className="size-4 animate-spin" />
              {t("Live.chat.empty")}
            </div>
          )}
          {messages.length === 0 && status === "error" && (
            <div className="text-muted-foreground flex min-h-40 flex-col items-center justify-center gap-2 text-center text-xs">
              <WifiOff className="size-4" />
              {t("Live.chat.unavailable")}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
