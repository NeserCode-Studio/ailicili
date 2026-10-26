import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { LoaderCircle, LogIn, Palette, Send } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n, useToast } from "@/composables";
import { useAuthStatus } from "@/features/auth/useAuthStatus";
import { sendDanmaku } from "@/lib/bili";
import { cn } from "@/lib/utils";
import type { DanmakuItem, DanmakuMode } from "@/shared/bili.types";

const COLORS = [0xffffff, 0xfe0302, 0xff7204, 0xffaa02, 0x00a1d6, 0x66ccff];
const FONT_SIZES = [18, 25, 36] as const;

interface DanmakuComposerProps {
  aid: number;
  cid: number;
  bvid: string;
  currentTime: number;
  portalContainer: HTMLElement | null;
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
  portalContainer,
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
      <div className="flex h-8 w-full max-w-md items-center justify-center rounded-md border border-white/10 bg-black/45 shadow-lg backdrop-blur-sm">
        <LoaderCircle className="size-4 animate-spin text-white/65" />
      </div>
    );
  }

  if (!authQuery.data?.authenticated) {
    return (
      <Link
        to="/login"
        className="flex h-8 w-full max-w-md items-center justify-center gap-2 rounded-md border border-white/10 bg-black/45 text-xs text-white/70 shadow-lg backdrop-blur-sm transition-colors hover:bg-white/10 hover:text-white"
      >
        <LogIn className="size-3.5" />
        {t("Danmaku.loginToSend")}
      </Link>
    );
  }

  return (
    <form
      data-player-editor
      onSubmit={submit}
      className="flex h-8 w-full max-w-md min-w-0 items-center gap-0.5 rounded-md border border-white/10 bg-black/45 p-0.5 shadow-lg backdrop-blur-sm focus-within:border-white/25 focus-within:bg-black/60"
    >
      <Input
        value={message}
        onChange={(event) => setMessage(event.currentTarget.value)}
        maxLength={100}
        placeholder={t("Danmaku.placeholder")}
        aria-label={t("Danmaku.placeholder")}
        title={`${message.length}/100`}
        className="h-7 min-w-0 flex-1 border-0 bg-transparent px-2 text-xs text-white shadow-none placeholder:text-white/40 focus-visible:ring-0 md:text-xs"
      />

      <PopoverPrimitive.Root>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            title={t("Danmaku.style")}
            aria-label={t("Danmaku.style")}
            className="flex size-7 shrink-0 items-center justify-center rounded-sm text-white/60 transition-colors hover:bg-white/10 hover:text-white data-[state=open]:bg-white/10 data-[state=open]:text-white"
          >
            <Palette className="size-3.5" />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal container={portalContainer ?? undefined}>
          <PopoverPrimitive.Content
            data-player-popover
            side="top"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            aria-label={t("Danmaku.style")}
            className="z-50 w-72 rounded-md border border-white/10 bg-[#18181b] p-3 text-white shadow-2xl outline-none"
          >
            <div>
              <p className="text-xs font-medium">{t("Danmaku.style")}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                {t("Danmaku.style.description")}
              </p>
            </div>

            <div className="mt-3 flex items-center gap-1 rounded-md border border-white/10 p-1">
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
                    "flex-1 rounded-sm px-2 py-1.5 text-[11px] text-white/55 transition-colors hover:bg-white/10 hover:text-white",
                    mode === value && "bg-white/12 text-white"
                  )}
                >
                  {t(label)}
                </button>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[11px] text-white/55">
                {t("Danmaku.color")}
              </span>
              <div className="flex items-center gap-2">
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
                      "size-4 rounded-full border border-white/25 transition-shadow",
                      color === value &&
                        "ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[#18181b]"
                    )}
                  />
                ))}
              </div>
            </div>

            <label className="mt-3 flex items-center justify-between gap-3 text-[11px] text-white/55">
              {t("Danmaku.size")}
              <select
                value={fontSize}
                onChange={(event) =>
                  setFontSize(
                    Number(
                      event.currentTarget.value
                    ) as (typeof FONT_SIZES)[number]
                  )
                }
                className="h-7 rounded-sm border border-white/10 bg-black/35 px-2 text-[11px] text-white outline-none"
              >
                {FONT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>

      <Button
        type="submit"
        size="icon"
        variant="ghost"
        disabled={!message.trim() || sendMutation.isPending}
        title={t("Danmaku.send")}
        aria-label={t("Danmaku.send")}
        className="size-7 shrink-0 rounded-sm text-white/70 hover:bg-white/10 hover:text-white"
      >
        {sendMutation.isPending ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Send className="size-3.5" />
        )}
      </Button>
    </form>
  );
}
