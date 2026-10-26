import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, LogIn, Send } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n, useToast } from "@/composables";
import { useAuthStatus } from "@/features/auth/useAuthStatus";
import { sendDanmaku } from "@/lib/bili";
import { formatDuration } from "@/lib/format";
import type { DanmakuItem, DanmakuMode } from "@/shared/bili.types";
import { cn } from "@/lib/utils";

const COLORS = [0xffffff, 0xfe0302, 0xff7204, 0xffaa02, 0x00a1d6, 0x66ccff];
const FONT_SIZES = [18, 25, 36] as const;

interface DanmakuComposerProps {
  aid: number;
  cid: number;
  bvid: string;
  currentTime: number;
  onSent: (item: DanmakuItem) => void;
}

function colorHex(value: number) {
  return `#${value.toString(16).padStart(6, "0")}`;
}

export default function DanmakuComposer({
  aid,
  cid,
  bvid,
  currentTime,
  onSent,
}: DanmakuComposerProps) {
  const { t } = useI18n();
  const { error: toastError, success } = useToast();
  const authQuery = useAuthStatus();
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<DanmakuMode>(1);
  const [color, setColor] = useState(COLORS[0]);
  const [fontSize, setFontSize] = useState<(typeof FONT_SIZES)[number]>(25);

  const sendMutation = useMutation({
    mutationFn: (item: DanmakuItem) =>
      sendDanmaku({
        aid,
        cid,
        bvid,
        message: item.text,
        progressMs: item.progressMs,
        mode: item.mode,
        color: item.color,
        fontSize: item.size,
      }),
    onSuccess: (_id, item) => {
      onSent(item);
      setMessage((current) => (current.trim() === item.text ? "" : current));
      success("Danmaku.sent");
    },
    onError: () => toastError("Danmaku.sendError"),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate({
      progressMs: Math.max(0, Math.round(currentTime * 1000)),
      mode,
      size: fontSize,
      color,
      text,
    });
  };

  if (authQuery.isPending) {
    return (
      <div className="border-border bg-popover text-muted-foreground flex h-12 items-center justify-center rounded-md border shadow-xl">
        <LoaderCircle className="size-4 animate-spin" />
      </div>
    );
  }

  if (!authQuery.data?.authenticated) {
    return (
      <Link
        to="/login"
        className="border-border bg-popover text-muted-foreground hover:text-foreground flex h-12 items-center justify-center gap-2 rounded-md border text-sm shadow-xl transition-colors"
      >
        <LogIn className="size-4" />
        {t("Danmaku.loginToSend")}
      </Link>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="border-border bg-popover text-popover-foreground rounded-md border p-2 shadow-xl"
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-12 shrink-0 text-center font-mono text-[11px] tabular-nums">
          {formatDuration(currentTime)}
        </span>
        <Input
          value={message}
          onChange={(event) => setMessage(event.currentTarget.value)}
          maxLength={100}
          placeholder={t("Danmaku.placeholder")}
          aria-label={t("Danmaku.placeholder")}
          className="h-8 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        />
        <span className="text-muted-foreground w-10 text-right text-[10px] tabular-nums">
          {message.length}/100
        </span>
        <Button
          type="submit"
          size="sm"
          disabled={!message.trim() || sendMutation.isPending}
        >
          {sendMutation.isPending ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Send />
          )}
          {t("Danmaku.send")}
        </Button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-3 border-t px-1 pt-2">
        <div
          className="flex items-center gap-1.5"
          aria-label={t("Danmaku.mode")}
        >
          {(
            [
              [1, "Danmaku.rolling"],
              [4, "Danmaku.bottom"],
              [5, "Danmaku.top"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "text-muted-foreground hover:text-foreground rounded-sm px-2 py-1 text-[11px] transition-colors",
                mode === value && "bg-muted text-foreground"
              )}
            >
              {t(label)}
            </button>
          ))}
        </div>

        <div
          className="flex items-center gap-1"
          aria-label={t("Danmaku.color")}
        >
          {COLORS.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`${t("Danmaku.color")} ${colorHex(value)}`}
              aria-pressed={color === value}
              title={colorHex(value)}
              onClick={() => setColor(value)}
              style={{ backgroundColor: colorHex(value) }}
              className={cn(
                "size-4 rounded-full border border-black/20 ring-offset-2 transition-shadow",
                color === value && "ring-2 ring-[var(--primary)]"
              )}
            />
          ))}
        </div>

        <label className="text-muted-foreground ml-auto flex items-center gap-1.5 text-[11px]">
          {t("Danmaku.size")}
          <select
            value={fontSize}
            onChange={(event) =>
              setFontSize(
                Number(event.currentTarget.value) as (typeof FONT_SIZES)[number]
              )
            }
            className="border-border bg-background text-foreground h-7 rounded-sm border px-1.5 text-[11px] outline-none"
          >
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
    </form>
  );
}
