import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronUp } from "lucide-react";

import { useI18n } from "@/composables";
import { cn } from "@/lib/utils";
import type { LivePlaybackQuality } from "@/shared/bili.types";

interface LiveQualityMenuProps {
  current: number;
  qualities: LivePlaybackQuality[];
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (quality: LivePlaybackQuality) => void;
}

export default function LiveQualityMenu({
  current,
  qualities,
  open,
  disabled = false,
  onOpenChange,
  onSelect,
}: LiveQualityMenuProps) {
  const { t } = useI18n();
  const selected = qualities.find((quality) => quality.id === current);
  const label = selected?.label ?? String(current);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          disabled={disabled || qualities.length <= 1}
          title={t("Player.quality.current", { quality: label })}
          aria-label={t("Player.quality.current", { quality: label })}
          className="flex h-8 max-w-24 min-w-12 items-center gap-1 rounded-md px-2 text-[11px] text-white/85 transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-60 data-[state=open]:bg-white/15"
        >
          <span className="truncate">{label}</span>
          <ChevronUp className="size-3 shrink-0 opacity-65" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
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
            {qualities.map((quality) => {
              const active = quality.id === current;
              return (
                <button
                  key={quality.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onSelect(quality);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none",
                    active ? "text-white" : "text-white/75"
                  )}
                >
                  <span className="truncate">{quality.label}</span>
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      active ? "opacity-100" : "opacity-0"
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
