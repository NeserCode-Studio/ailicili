import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Gauge,
  History,
  MessageSquareText,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/composables";
import type {
  DanmakuFontWeight,
  DanmakuSettings,
} from "@/features/danmaku/DanmakuCanvas";
import {
  PLAYBACK_SPEEDS,
  type PlayerPreferences,
} from "@/features/player/playerPreferences";
import type { DanmakuMode, PlaybackQuality } from "@/shared/bili.types";
import { cn } from "@/lib/utils";

const DANMAKU_TYPES: Array<{ mode: DanmakuMode; label: string }> = [
  { mode: 1, label: "Danmaku.rolling" },
  { mode: 4, label: "Danmaku.bottom" },
  { mode: 5, label: "Danmaku.top" },
];

const FONT_WEIGHTS: Array<{
  value: DanmakuFontWeight;
  label: string;
}> = [
  { value: 400, label: "Player.settings.fontWeight.regular" },
  { value: 500, label: "Player.settings.fontWeight.medium" },
  { value: 600, label: "Player.settings.fontWeight.semibold" },
  { value: 700, label: "Player.settings.fontWeight.bold" },
];

interface PlayerSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portalContainer: HTMLElement | null;
  preferences: PlayerPreferences;
  qualities: PlaybackQuality[];
  onPreferencesChange: (
    update: (current: PlayerPreferences) => PlayerPreferences
  ) => void;
  onReset: () => void;
}

function SettingsGroup({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Settings2;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="bg-primary/10 text-primary mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
            {description}
          </p>
        </div>
      </div>
      <div className="border-border/70 divide-border/70 divide-y overflow-hidden rounded-md border">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  title,
  description,
  control,
}: {
  title: string;
  description: string;
  control: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          {description}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 sm:w-52 sm:justify-end">
        {control}
      </div>
    </div>
  );
}

function SliderRow({
  id,
  title,
  description,
  value,
  min,
  max,
  step,
  valueLabel,
  onChange,
}: {
  id: string;
  title: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  valueLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <div className="flex w-full items-center gap-3">
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => onChange(Number(event.currentTarget.value))}
            aria-label={title}
            className="accent-primary min-w-0 flex-1"
          />
          <span className="text-muted-foreground w-12 text-right font-mono text-[11px] tabular-nums">
            {valueLabel}
          </span>
        </div>
      }
    />
  );
}

export default function PlayerSettingsDialog({
  open,
  onOpenChange,
  portalContainer,
  preferences,
  qualities,
  onPreferencesChange,
  onReset,
}: PlayerSettingsDialogProps) {
  const { t } = useI18n();
  const updateDanmaku = (patch: Partial<DanmakuSettings>) => {
    onPreferencesChange((current) => ({
      ...current,
      danmaku: { ...current.danmaku, ...patch },
    }));
  };
  const toggleMode = (mode: DanmakuMode, checked: boolean) => {
    updateDanmaku({
      modes: checked
        ? [...preferences.danmaku.modes, mode]
        : preferences.danmaku.modes.filter((value) => value !== mode),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal container={portalContainer ?? undefined}>
        <DialogOverlay className="z-40" />
        <DialogPrimitive.Content
          data-testid="player-settings-dialog"
          className="bg-background text-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-1/2 left-1/2 z-50 flex h-[min(84vh,44rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border p-0 shadow-2xl duration-200"
        >
          <header className="bg-muted/40 flex shrink-0 items-start gap-3 border-b px-5 py-4 pr-12">
            <span className="bg-primary/10 text-primary mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md">
              <Settings2 className="size-4.5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold">
                {t("Player.settings")}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-relaxed">
                {t("Player.settings.description")}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                aria-label={t("Player.settings.close")}
                className="text-muted-foreground hover:bg-accent hover:text-foreground absolute top-3 right-3 flex size-8 items-center justify-center rounded-md transition-colors"
              >
                <X className="size-4" />
              </button>
            </DialogClose>
          </header>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-6 px-5 py-5">
              <SettingsGroup
                icon={Gauge}
                title={t("Player.settings.group.playback")}
                description={t("Player.settings.group.playback.description")}
              >
                <SettingsRow
                  title={t("Player.speed")}
                  description={t("Player.settings.speed.description")}
                  control={
                    <select
                      value={preferences.speed}
                      onChange={(event) => {
                        const speed = Number(event.currentTarget.value);
                        onPreferencesChange((current) => ({
                          ...current,
                          speed,
                        }));
                      }}
                      aria-label={t("Player.speed")}
                      className="border-input bg-background h-8 w-full rounded-md border px-2 text-sm outline-none focus:border-[var(--ring)]"
                    >
                      {PLAYBACK_SPEEDS.map((speed) => (
                        <option key={speed} value={speed}>
                          {speed}x
                        </option>
                      ))}
                    </select>
                  }
                />
                <SettingsRow
                  title={t("Player.settings.autoPlay")}
                  description={t("Player.settings.autoPlay.description")}
                  control={
                    <Switch
                      checked={preferences.autoPlay}
                      onCheckedChange={(checked) =>
                        onPreferencesChange((current) => ({
                          ...current,
                          autoPlay: checked,
                        }))
                      }
                      aria-label={t("Player.settings.autoPlay")}
                    />
                  }
                />
                <SettingsRow
                  title={t("Player.settings.autoHideControls")}
                  description={t(
                    "Player.settings.autoHideControls.description"
                  )}
                  control={
                    <Switch
                      checked={preferences.autoHideControls}
                      onCheckedChange={(checked) =>
                        onPreferencesChange((current) => ({
                          ...current,
                          autoHideControls: checked,
                        }))
                      }
                      aria-label={t("Player.settings.autoHideControls")}
                    />
                  }
                />
              </SettingsGroup>

              <SettingsGroup
                icon={SlidersHorizontal}
                title={t("Player.settings.group.quality")}
                description={t("Player.settings.group.quality.description")}
              >
                <SettingsRow
                  title={t("Player.quality")}
                  description={t("Player.settings.quality.description")}
                  control={
                    <select
                      value={preferences.quality}
                      onChange={(event) => {
                        const quality = event.currentTarget.value;
                        onPreferencesChange((current) => ({
                          ...current,
                          quality,
                        }));
                      }}
                      aria-label={t("Player.quality")}
                      className="border-input bg-background h-8 w-full rounded-md border px-2 text-sm outline-none focus:border-[var(--ring)]"
                    >
                      <option value="auto">{t("Player.auto")}</option>
                      {qualities.map((quality) => (
                        <option key={quality.id} value={quality.id}>
                          {quality.label}
                        </option>
                      ))}
                    </select>
                  }
                />
                <SettingsRow
                  title={t("Player.settings.fastSwitch")}
                  description={t("Player.settings.fastSwitch.description")}
                  control={
                    <Switch
                      checked={preferences.fastSwitchEnabled}
                      onCheckedChange={(checked) =>
                        onPreferencesChange((current) => ({
                          ...current,
                          fastSwitchEnabled: checked,
                        }))
                      }
                      aria-label={t("Player.settings.fastSwitch")}
                    />
                  }
                />
              </SettingsGroup>

              <SettingsGroup
                icon={History}
                title={t("Player.settings.group.progress")}
                description={t("Player.settings.group.progress.description")}
              >
                <SettingsRow
                  title={t("Player.settings.resumeProgress")}
                  description={t("Player.settings.resumeProgress.description")}
                  control={
                    <Switch
                      checked={preferences.resumeProgress}
                      onCheckedChange={(checked) =>
                        onPreferencesChange((current) => ({
                          ...current,
                          resumeProgress: checked,
                        }))
                      }
                      aria-label={t("Player.settings.resumeProgress")}
                    />
                  }
                />
                <SettingsRow
                  title={t("Player.settings.syncProgress")}
                  description={t("Player.settings.syncProgress.description")}
                  control={
                    <Switch
                      checked={preferences.syncProgress}
                      onCheckedChange={(checked) =>
                        onPreferencesChange((current) => ({
                          ...current,
                          syncProgress: checked,
                        }))
                      }
                      aria-label={t("Player.settings.syncProgress")}
                    />
                  }
                />
              </SettingsGroup>

              <SettingsGroup
                icon={MessageSquareText}
                title={t("Player.settings.group.danmaku")}
                description={t("Player.settings.group.danmaku.description")}
              >
                <SettingsRow
                  title={t("Player.settings.danmakuEnabled")}
                  description={t("Player.settings.danmakuEnabled.description")}
                  control={
                    <Switch
                      checked={preferences.danmaku.enabled}
                      onCheckedChange={(checked) =>
                        updateDanmaku({ enabled: checked })
                      }
                      aria-label={t("Player.settings.danmakuEnabled")}
                    />
                  }
                />
                <SliderRow
                  id="player-danmaku-opacity"
                  title={t("Player.danmakuOpacity")}
                  description={t("Player.settings.danmakuOpacity.description")}
                  value={preferences.danmaku.opacity}
                  min={0.2}
                  max={1}
                  step={0.05}
                  valueLabel={`${Math.round(preferences.danmaku.opacity * 100)}%`}
                  onChange={(opacity) => updateDanmaku({ opacity })}
                />
                <SliderRow
                  id="player-danmaku-font"
                  title={t("Player.danmakuFontSize")}
                  description={t("Player.settings.danmakuFontSize.description")}
                  value={preferences.danmaku.fontScale}
                  min={0.7}
                  max={1.5}
                  step={0.1}
                  valueLabel={`${Math.round(preferences.danmaku.fontScale * 100)}%`}
                  onChange={(fontScale) => updateDanmaku({ fontScale })}
                />
                <SettingsRow
                  title={t("Player.settings.danmakuWeight")}
                  description={t("Player.settings.danmakuWeight.description")}
                  control={
                    <select
                      value={preferences.danmaku.fontWeight}
                      onChange={(event) =>
                        updateDanmaku({
                          fontWeight: Number(
                            event.currentTarget.value
                          ) as DanmakuFontWeight,
                        })
                      }
                      aria-label={t("Player.settings.danmakuWeight")}
                      className="border-input bg-background h-8 w-full rounded-md border px-2 text-sm outline-none focus:border-[var(--ring)]"
                    >
                      {FONT_WEIGHTS.map((weight) => (
                        <option key={weight.value} value={weight.value}>
                          {t(weight.label)}
                        </option>
                      ))}
                    </select>
                  }
                />
                <SliderRow
                  id="player-danmaku-outline"
                  title={t("Player.settings.danmakuOutline")}
                  description={t("Player.settings.danmakuOutline.description")}
                  value={preferences.danmaku.outlineWidth}
                  min={0}
                  max={4}
                  step={0.5}
                  valueLabel={`${preferences.danmaku.outlineWidth}px`}
                  onChange={(outlineWidth) => updateDanmaku({ outlineWidth })}
                />
                <SliderRow
                  id="player-danmaku-speed"
                  title={t("Player.danmakuSpeed")}
                  description={t("Player.settings.danmakuSpeed.description")}
                  value={preferences.danmaku.speed}
                  min={0.5}
                  max={2}
                  step={0.1}
                  valueLabel={`${preferences.danmaku.speed.toFixed(1)}x`}
                  onChange={(speed) => updateDanmaku({ speed })}
                />
                <SliderRow
                  id="player-danmaku-area"
                  title={t("Player.danmakuArea")}
                  description={t("Player.settings.danmakuArea.description")}
                  value={preferences.danmaku.area}
                  min={0.2}
                  max={1}
                  step={0.05}
                  valueLabel={`${Math.round(preferences.danmaku.area * 100)}%`}
                  onChange={(area) => updateDanmaku({ area })}
                />
                <SliderRow
                  id="player-danmaku-density"
                  title={t("Player.danmakuDensity")}
                  description={t("Player.settings.danmakuDensity.description")}
                  value={preferences.danmaku.density}
                  min={10}
                  max={100}
                  step={10}
                  valueLabel={`${preferences.danmaku.density}%`}
                  onChange={(density) => updateDanmaku({ density })}
                />
                <SettingsRow
                  title={t("Player.danmakuTypes")}
                  description={t("Player.settings.danmakuTypes.description")}
                  control={
                    <div className="flex flex-wrap justify-end gap-2">
                      {DANMAKU_TYPES.map(({ mode, label }) => {
                        const selected =
                          preferences.danmaku.modes.includes(mode);
                        return (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => toggleMode(mode, !selected)}
                            className={cn(
                              "border-border text-muted-foreground rounded-sm border px-2.5 py-1 text-xs transition-colors",
                              selected &&
                                "border-primary/40 bg-primary/10 text-primary"
                            )}
                          >
                            {t(label)}
                          </button>
                        );
                      })}
                    </div>
                  }
                />
              </SettingsGroup>
            </div>
          </ScrollArea>

          <footer className="bg-muted/30 flex shrink-0 items-center justify-between gap-3 border-t px-5 py-3">
            <Button type="button" size="sm" variant="ghost" onClick={onReset}>
              <RotateCcw />
              {t("Player.settings.reset")}
            </Button>
            <DialogClose asChild>
              <Button type="button" size="sm">
                {t("Player.settings.done")}
              </Button>
            </DialogClose>
          </footer>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
