import { useI18n } from "@/composables";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type {
  SettingInputItemProps,
  SettingSelectItemProps,
  SettingOptionalItemProps,
  SettingItemGroup,
} from "@/shared";

/** 统一的设置项外壳：左侧标题/描述，右侧控件，悬停高亮 */
function SettingItemShell({
  title,
  description,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`group stack-3 border-border/60 bg-card hover:border-border hover:bg-accent/30 rounded-xl border p-4 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-6 ${className}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {title ? (
          <span className="text-sm leading-tight font-medium">{title}</span>
        ) : null}
        {description ? (
          <span className="text-muted-foreground text-xs leading-relaxed">
            {description}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:w-[22rem] sm:justify-end">
        {children}
      </div>
    </div>
  );
}

export function SettingItemGroup({
  title,
  description,
  children,
}: SettingItemGroup) {
  return (
    <section className="stack-3">
      <div className="stack-1">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {description ? <p className="text-muted-xs">{description}</p> : null}
      </div>
      <div className="stack-3">{children}</div>
    </section>
  );
}

export function SettingInputItem({
  type,
  placeholder,
  onItemSubmit,
  submit,
  value,
  title,
  description,
  autoComplete = true,
}: SettingInputItemProps & { autoComplete?: boolean }) {
  const { t } = useI18n();

  return (
    <form action={onItemSubmit}>
      <SettingItemShell title={title} description={description}>
        <Input
          type={type}
          placeholder={
            placeholder ?? t("Settings.items.input.default.placeholder")
          }
          autoComplete={autoComplete ? "on" : "off"}
          name="input"
          defaultValue={value}
          className="flex-1"
        />
        <Button type="submit" size="sm">
          {submit ?? t("Settings.items.input.default.submit")}
        </Button>
      </SettingItemShell>
    </form>
  );
}

export function SettingSelectItem({
  placeholder,
  onItemSubmit,
  onItemChange,
  submit,
  label,
  items,
  value,
  title,
  description,
}: SettingSelectItemProps) {
  const { t } = useI18n();

  return (
    <form action={onItemSubmit}>
      <SettingItemShell title={title} description={description}>
        <Select
          name="select"
          onValueChange={onItemChange}
          defaultValue={value?.value}
        >
          <SelectTrigger className="flex-1">
            <SelectValue
              placeholder={
                placeholder ?? t("Settings.items.select.default.placeholder")
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>
                {label ?? t("Settings.items.select.default.label")}
              </SelectLabel>
              {items?.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button type="submit" size="sm">
          {submit ?? t("Settings.items.select.default.submit")}
        </Button>
      </SettingItemShell>
    </form>
  );
}

export function SettingOptionalItem({
  onItemChange,
  id,
  label,
  value,
  title,
  description,
}: SettingOptionalItemProps) {
  return (
    <SettingItemShell title={title} description={description}>
      <Checkbox
        onCheckedChange={onItemChange}
        defaultChecked={value}
        id={id}
        name="optional"
      />
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
        {label}
      </Label>
    </SettingItemShell>
  );
}
