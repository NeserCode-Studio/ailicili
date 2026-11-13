import {
  useId,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Captions,
  CaptionsOff,
  Check,
  MoveHorizontal,
  Palette,
  Pin,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/composables";
import {
  DANMAKU_DISPLAY_AREA_MAX,
  DANMAKU_DISPLAY_AREA_MIN,
  DANMAKU_OPACITY_MAX,
  DANMAKU_OPACITY_MIN,
  DANMAKU_SCALE_MAX,
  DANMAKU_SCALE_MIN,
  DANMAKU_SPEED_MAX,
  DANMAKU_SPEED_MIN,
  updateDanmakuPreferences,
  useDanmakuPreferences,
  type DanmakuFontFamily,
  type DanmakuStrokeType,
} from "@/lib/danmaku/preferences";
import { PLAYER_CONTROL_SURFACE_CLASS } from "@/lib/player-surface";
import { cn } from "@/lib/utils";

const FONT_OPTIONS: readonly DanmakuFontFamily[] = ["default", "hei", "song"];
const STROKE_OPTIONS: readonly DanmakuStrokeType[] = [
  "heavy",
  "outline",
  "projection",
];

function SegmentButton({
  active,
  compact = false,
  children,
  className,
  ...props
}: ComponentProps<"button"> & { active: boolean; compact?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "focus-visible:ring-ring flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
        compact && "h-7 gap-1 px-1.5 text-[11px]",
        active
          ? "text-foreground border-[var(--player-accent)] bg-[var(--player-accent)]/12"
          : "border-border bg-background/45 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className
      )}
      {...props}
    >
      {active ? <Check className="size-3 shrink-0" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

function FilterButton({
  active,
  compact = false,
  disabled,
  icon,
  label,
  title,
  onClick,
}: {
  active: boolean;
  compact?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      className={cn(
        "focus-visible:ring-ring flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md border text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
        compact && "h-11 gap-0.5 text-[10px]",
        active
          ? "text-foreground border-[var(--player-accent)] bg-[var(--player-accent)]/12"
          : "border-border bg-background/45 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function PreferenceSlider({
  id,
  label,
  compact = false,
  value,
  valueLabel,
  min,
  max,
  step,
  onChange,
}: {
  id: string;
  label: string;
  compact?: boolean;
  value: number;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={id}
          className={
            compact ? "text-[11px] font-medium" : "text-xs font-medium"
          }
        >
          {label}
        </label>
        <span
          className={cn(
            "text-muted-foreground w-10 text-right tabular-nums",
            compact ? "text-[10px]" : "text-[11px]"
          )}
        >
          {valueLabel}
        </span>
      </div>
      <Slider
        id={id}
        aria-label={label}
        aria-valuetext={valueLabel}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([nextValue]) =>
          onChange(Math.round(nextValue * 100) / 100)
        }
      />
    </div>
  );
}

function SwitchRow({
  id,
  label,
  compact = false,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  compact?: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        compact ? "min-h-7 gap-2" : "min-h-8 gap-3"
      )}
    >
      <label
        htmlFor={id}
        className={cn(
          "cursor-pointer font-medium",
          compact ? "text-[11px] leading-tight" : "text-xs"
        )}
      >
        {label}
      </label>
      <Switch
        id={id}
        className={compact ? "origin-right scale-90" : undefined}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function DanmakuSettingsPanel({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const preferences = useDanmakuPreferences();
  const idPrefix = useId();
  const sectionLabelClassName = cn(
    "font-medium",
    compact ? "text-[11px] leading-none" : "text-xs"
  );

  const body = (
    <>
      {!compact ? (
        <SwitchRow
          id={`${idPrefix}-enabled`}
          label={t("Danmaku.settings.enabled")}
          checked={preferences.enabled}
          onCheckedChange={(enabled) => updateDanmakuPreferences({ enabled })}
        />
      ) : null}

      <div
        role="group"
        aria-label={t("Danmaku.settings.filter.title")}
        className={compact ? "space-y-1.5" : "space-y-2"}
      >
        <p className={sectionLabelClassName}>
          {t("Danmaku.settings.filter.title")}
        </p>
        <div className={cn("grid grid-cols-4", compact ? "gap-1" : "gap-1.5")}>
          <FilterButton
            active={preferences.showScroll}
            compact={compact}
            icon={<MoveHorizontal className="size-4" aria-hidden="true" />}
            label={t("Danmaku.settings.filter.scroll")}
            onClick={() =>
              updateDanmakuPreferences({
                showScroll: !preferences.showScroll,
              })
            }
          />
          <FilterButton
            active={preferences.showFixed}
            compact={compact}
            icon={<Pin className="size-4" aria-hidden="true" />}
            label={t("Danmaku.settings.filter.fixed")}
            onClick={() =>
              updateDanmakuPreferences({
                showFixed: !preferences.showFixed,
              })
            }
          />
          <FilterButton
            active={preferences.showColor}
            compact={compact}
            icon={<Palette className="size-4" aria-hidden="true" />}
            label={t("Danmaku.settings.filter.color")}
            onClick={() =>
              updateDanmakuPreferences({
                showColor: !preferences.showColor,
              })
            }
          />
          <FilterButton
            active={false}
            compact={compact}
            disabled
            icon={<Sparkles className="size-4" aria-hidden="true" />}
            label={t("Danmaku.settings.filter.advanced")}
            title={t("Danmaku.settings.filter.advancedUnsupported")}
          />
        </div>
      </div>

      <div className={compact ? "space-y-1.5" : "space-y-2"}>
        <p className={sectionLabelClassName}>{t("Danmaku.settings.font")}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {FONT_OPTIONS.map((font) => (
            <SegmentButton
              key={font}
              active={preferences.fontFamily === font}
              compact={compact}
              onClick={() => updateDanmakuPreferences({ fontFamily: font })}
            >
              {t(`Danmaku.settings.font.${font}`)}
            </SegmentButton>
          ))}
        </div>
      </div>

      <div className={compact ? "space-y-1.5" : "space-y-2"}>
        <p className={sectionLabelClassName}>{t("Danmaku.settings.stroke")}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {STROKE_OPTIONS.map((stroke) => (
            <SegmentButton
              key={stroke}
              active={preferences.strokeType === stroke}
              compact={compact}
              onClick={() => updateDanmakuPreferences({ strokeType: stroke })}
            >
              {t(`Danmaku.settings.stroke.${stroke}`)}
            </SegmentButton>
          ))}
        </div>
      </div>

      <div
        className={cn(
          "grid grid-cols-2",
          compact ? "gap-x-3 gap-y-0.5" : "gap-x-4 gap-y-1"
        )}
      >
        <SwitchRow
          id={`${idPrefix}-bold`}
          compact={compact}
          label={t("Danmaku.settings.bold")}
          checked={preferences.bold}
          onCheckedChange={(bold) => updateDanmakuPreferences({ bold })}
        />
        <SwitchRow
          id={`${idPrefix}-scale-with-player`}
          compact={compact}
          label={t("Danmaku.settings.scaleWithPlayer")}
          checked={preferences.scaleWithPlayer}
          onCheckedChange={(scaleWithPlayer) =>
            updateDanmakuPreferences({ scaleWithPlayer })
          }
        />
        <SwitchRow
          id={`${idPrefix}-sync-playback-rate`}
          compact={compact}
          label={t("Danmaku.settings.syncPlaybackRate")}
          checked={preferences.syncPlaybackRate}
          onCheckedChange={(syncPlaybackRate) =>
            updateDanmakuPreferences({ syncPlaybackRate })
          }
        />
        <SwitchRow
          id={`${idPrefix}-avoid-subtitles`}
          compact={compact}
          label={t("Danmaku.settings.avoidSubtitles")}
          checked={preferences.avoidSubtitles}
          onCheckedChange={(avoidSubtitles) =>
            updateDanmakuPreferences({ avoidSubtitles })
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <PreferenceSlider
          id={`${idPrefix}-display-area`}
          compact={compact}
          label={t("Danmaku.settings.displayArea")}
          value={preferences.displayArea}
          valueLabel={`${Math.round(preferences.displayArea * 100)}%`}
          min={DANMAKU_DISPLAY_AREA_MIN}
          max={DANMAKU_DISPLAY_AREA_MAX}
          step={0.05}
          onChange={(displayArea) => updateDanmakuPreferences({ displayArea })}
        />
        <PreferenceSlider
          id={`${idPrefix}-opacity`}
          compact={compact}
          label={t("Danmaku.settings.opacity")}
          value={preferences.opacity}
          valueLabel={`${Math.round(preferences.opacity * 100)}%`}
          min={DANMAKU_OPACITY_MIN}
          max={DANMAKU_OPACITY_MAX}
          step={0.05}
          onChange={(opacity) => updateDanmakuPreferences({ opacity })}
        />
        <PreferenceSlider
          id={`${idPrefix}-scale`}
          compact={compact}
          label={t("Danmaku.settings.size")}
          value={preferences.scale}
          valueLabel={`${Math.round(preferences.scale * 100)}%`}
          min={DANMAKU_SCALE_MIN}
          max={DANMAKU_SCALE_MAX}
          step={0.05}
          onChange={(scale) => updateDanmakuPreferences({ scale })}
        />
        <PreferenceSlider
          id={`${idPrefix}-speed`}
          compact={compact}
          label={t("Danmaku.settings.speed")}
          value={preferences.speed}
          valueLabel={`${preferences.speed.toFixed(1)}x`}
          min={DANMAKU_SPEED_MIN}
          max={DANMAKU_SPEED_MAX}
          step={0.1}
          onChange={(speed) => updateDanmakuPreferences({ speed })}
        />
      </div>
    </>
  );

  if (compact) {
    return (
      <ScrollArea
        type="auto"
        aria-label={t("Settings.danmaku.title")}
        className={cn("w-full rounded-[inherit]", className)}
        viewportClassName="max-h-[min(65vh,26rem)]"
      >
        <div className="space-y-2.5 p-2.5 pr-5">{body}</div>
      </ScrollArea>
    );
  }

  return <div className={cn("space-y-4", className)}>{body}</div>;
}

export function DanmakuControlButton({
  portalContainerRef,
  triggerClassName,
  onOpenChange,
}: {
  portalContainerRef?: RefObject<HTMLElement | null>;
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const preferences = useDanmakuPreferences();
  const label = t(
    preferences.enabled ? "Danmaku.player.hide" : "Danmaku.player.show"
  );

  return (
    <HoverCard openDelay={180} closeDelay={120} onOpenChange={onOpenChange}>
      <HoverCardTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={triggerClassName}
          aria-label={label}
          title={label}
          onClick={() =>
            updateDanmakuPreferences({
              enabled: !preferences.enabled,
            })
          }
        >
          {preferences.enabled ? <Captions /> : <CaptionsOff />}
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        portalContainer={portalContainerRef?.current}
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          PLAYER_CONTROL_SURFACE_CLASS,
          "w-[24rem] max-w-[calc(100vw-1.5rem)] overflow-hidden border p-0 shadow-2xl"
        )}
      >
        <DanmakuSettingsPanel compact />
      </HoverCardContent>
    </HoverCard>
  );
}
