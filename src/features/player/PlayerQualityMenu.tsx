import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronUp } from "lucide-react";

import { useI18n } from "@/composables";
import { cn } from "@/lib/utils";
import type { PlaybackQuality } from "@/shared/bili.types";

interface PlayerQualityMenuProps {
  quality: string;
  qualities: PlaybackQuality[];
  portalContainer: HTMLElement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onQualityChange: (quality: string) => void;
}

export default function PlayerQualityMenu({
  quality,
  qualities,
  portalContainer,
  open,
  onOpenChange,
  onQualityChange,
}: PlayerQualityMenuProps) {
  const { t } = useI18n();
  const selectedQuality = qualities.find((item) => String(item.id) === quality);
  const label = selectedQuality?.label ?? t("Player.auto");

  const selectQuality = (value: string) => {
    onQualityChange(value);
    onOpenChange(false);
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          title={t("Player.quality.current", { quality: label })}
          aria-label={t("Player.quality.current", { quality: label })}
          className="flex h-8 max-w-28 min-w-14 items-center gap-1 rounded-md px-2 text-[11px] text-white/85 transition-colors hover:bg-white/15 hover:text-white data-[state=open]:bg-white/15 data-[state=open]:text-white"
        >
          <span className="truncate">{label}</span>
          <ChevronUp className="size-3 shrink-0 opacity-65" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal container={portalContainer ?? undefined}>
        <PopoverPrimitive.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label={t("Player.quality")}
          className="z-50 w-44 rounded-md border border-white/10 bg-[#18181b] p-1 text-white shadow-2xl outline-none"
        >
          <p className="px-2 py-1.5 text-[11px] font-medium text-white/50">
            {t("Player.quality")}
          </p>
          <div role="listbox" aria-label={t("Player.quality")}>
            {[
              { value: "auto", label: t("Player.auto") },
              ...qualities.map((item) => ({
                value: String(item.id),
                label: item.label,
              })),
            ].map((option) => {
              const selected = option.value === quality;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => selectQuality(option.value)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none",
                    selected ? "text-white" : "text-white/75"
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      selected ? "opacity-100" : "opacity-0"
                    )}
                  />
                </button>
              );
            })}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
