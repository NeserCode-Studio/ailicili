import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Check, ChevronUp } from "lucide-react";

import { useI18n } from "@/composables";
import { PLAYBACK_SPEEDS } from "@/features/player/playerPreferences";
import { cn } from "@/lib/utils";

interface PlayerSpeedMenuProps {
  speed: number;
  portalContainer: HTMLElement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSpeedChange: (speed: number) => void;
}

function formatSpeed(speed: number) {
  return `${speed}x`;
}

export default function PlayerSpeedMenu({
  speed,
  portalContainer,
  open,
  onOpenChange,
  onSpeedChange,
}: PlayerSpeedMenuProps) {
  const { t } = useI18n();
  const currentSpeed = formatSpeed(speed);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          title={t("Player.speed.current", { speed: currentSpeed })}
          aria-label={t("Player.speed.current", { speed: currentSpeed })}
          className="flex h-8 min-w-12 items-center justify-center gap-1 rounded-md px-2 font-mono text-[11px] text-white/85 transition-colors hover:bg-white/15 hover:text-white data-[state=open]:bg-white/15 data-[state=open]:text-white"
        >
          <span>{currentSpeed}</span>
          <ChevronUp className="size-3 shrink-0 opacity-65" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal container={portalContainer ?? undefined}>
        <PopoverPrimitive.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label={t("Player.speed")}
          data-player-popover
          className="z-50 w-36 rounded-md border border-white/10 bg-[#18181b] p-1 text-white shadow-2xl outline-none"
        >
          <p className="px-2 py-1.5 text-[11px] font-medium text-white/50">
            {t("Player.speed")}
          </p>
          <div role="listbox" aria-label={t("Player.speed")}>
            {PLAYBACK_SPEEDS.map((option) => {
              const label = formatSpeed(option);
              const selected = option === speed;
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onSpeedChange(option);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left font-mono text-xs transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none",
                    selected ? "text-white" : "text-white/75"
                  )}
                >
                  <span>{label}</span>
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
