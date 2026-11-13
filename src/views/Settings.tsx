import { TitleContext } from "@/contexts/title";
import { useLocalStorageState } from "ahooks";
import { useContext, useEffect, useMemo, useState } from "react";
import { useI18n, useToast } from "@/composables";
import AccountCenter from "@/components/account/AccountCenter";
import {
  SettingInputItem,
  SettingItemGroup,
  SettingOptionalItem,
  SettingSelectItem,
} from "@/components/SettingItems";
import { DanmakuSettingsPanel } from "@/components/danmaku/DanmakuControl";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  History,
  Search,
  Settings2,
  Trash2,
  UserRound,
} from "lucide-react";

import type { SettingSelectItemItem } from "@/shared";
import {
  setRecommendationPriority,
  useRecommendationPriority,
  type RecommendationPriority,
} from "@/lib/preferences";
import type { SettingsTab } from "@/contexts/settings";

/** 设置项索引：供搜索与「最近修改」跳转使用 */
interface SettingIndexItem {
  id: string;
  group: SettingsTab;
  labelKey: string;
  keywords: string[];
}

const SETTING_INDEX: SettingIndexItem[] = [
  {
    id: "account",
    group: "account",
    labelKey: "Settings.tabs.account",
    keywords: [
      "account",
      "login",
      "qr",
      "sms",
      "账号",
      "登录",
      "二维码",
      "验证码",
    ],
  },
  {
    id: "title",
    group: "general",
    labelKey: "Settings.items.title.title",
    keywords: ["title", "window", "标题", "窗口"],
  },
  {
    id: "lang",
    group: "general",
    labelKey: "Settings.items.lang.title",
    keywords: ["lang", "language", "i18n", "语言"],
  },
  {
    id: "auto-complete",
    group: "general",
    labelKey: "Settings.items.auto-complete.title",
    keywords: ["auto", "complete", "自动补全", "补全"],
  },
  {
    id: "recommendation-priority",
    group: "general",
    labelKey: "Settings.items.recommendation-priority.title",
    keywords: [
      "recommend",
      "personalized",
      "anonymous",
      "推荐",
      "个性化",
      "热门",
    ],
  },
  {
    id: "danmaku",
    group: "general",
    labelKey: "Settings.danmaku.title",
    keywords: [
      "danmaku",
      "subtitle",
      "overlay",
      "font",
      "speed",
      "area",
      "弹幕",
      "字体",
      "速度",
      "显示区域",
      "透明度",
      "字号",
      "显示",
    ],
  },
];

interface ChangedRecord {
  id: string;
  label: string;
  group: SettingsTab;
  at: number;
}

const MAX_HISTORY = 8;

export default function Settings({
  initialTab = "search",
}: {
  initialTab?: SettingsTab;
}) {
  const { t, setLang, lang } = useI18n();
  const { title, setTitle } = useContext(TitleContext);
  const recommendationPriority = useRecommendationPriority();
  const [autoComplete, setAutoComplete] = useLocalStorageState(
    "use-auto-complete",
    {
      defaultValue: true,
    }
  );
  const { success, error } = useToast({
    duration: 2000,
  });

  /* 搜索历史 + 修改记录（localStorage 持久化） */
  const [searchHistory, setSearchHistory] = useLocalStorageState<string[]>(
    "settings-search-history",
    { defaultValue: [] }
  );
  const [changedRecords, setChangedRecords] = useLocalStorageState<
    ChangedRecord[]
  >("settings-changed-history", { defaultValue: [] });

  const history = searchHistory ?? [];
  const changed = changedRecords ?? [];

  /* 搜索状态 */
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const recordChange = (id: string, labelKey: string) => {
    const meta = SETTING_INDEX.find((item) => item.id === id);
    const record: ChangedRecord = {
      id,
      label: t(labelKey),
      group: meta?.group ?? "general",
      at: Date.now(),
    };
    setChangedRecords((prev) => {
      const list = prev ?? [];
      return [record, ...list.filter((r) => r.id !== id)].slice(0, MAX_HISTORY);
    });
  };

  const recordSearch = (term: string) => {
    const s = term.trim();
    if (!s) return;
    setSearchHistory((prev) => {
      const list = prev ?? [];
      return [s, ...list.filter((x) => x !== s)].slice(0, MAX_HISTORY);
    });
  };

  const clearHistory = () => {
    setSearchHistory([]);
    setChangedRecords([]);
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SETTING_INDEX.filter((item) => {
      const label = t(item.labelKey).toLowerCase();
      return (
        label.includes(q) ||
        item.keywords.some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [query, t]);

  const jumpTo = (group: SettingsTab) => {
    setActiveTab(group);
    setQuery("");
  };

  /* setting title item */
  const titleAction = (data: FormData) => {
    if (!data || !data.get("input") || data.get("input") === title)
      return error("Settings.items.title.error");
    setTitle(data.get("input") as string);
    recordChange("title", "Settings.items.title.title");
    success("Settings.items.title.success");
  };

  /* setting lang item */
  const langItems: SettingSelectItemItem[] = [
    {
      value: "en-US",
      label: "English(US)",
    },
    {
      value: "zh-CN",
      label: "简体中文",
    },
  ];
  const langAction = (data: FormData) => {
    if (!data || !data.get("select") || data.get("select") === lang)
      return error("Settings.items.lang.error");

    setLang(data.get("select") as string);
    recordChange("lang", "Settings.items.lang.title");
    success("Settings.items.lang.success");
  };

  /* setting auto-complete item */
  const autoCompleteAction = (checked: boolean) => {
    setAutoComplete(checked);
    recordChange("auto-complete", "Settings.items.auto-complete.title");
    success("Settings.items.auto-complete.success");
  };

  const recommendationItems: SettingSelectItemItem[] = [
    {
      value: "anonymous",
      label: t("Settings.items.recommendation-priority.anonymous"),
    },
    {
      value: "personalized",
      label: t("Settings.items.recommendation-priority.personalized"),
    },
  ];
  const recommendationAction = (data: FormData) => {
    const value = data.get("select");
    if (value !== "anonymous" && value !== "personalized") {
      return error("Settings.items.recommendation-priority.error");
    }
    if (value === recommendationPriority) {
      return error("Settings.items.recommendation-priority.error");
    }
    setRecommendationPriority(value as RecommendationPriority);
    recordChange(
      "recommendation-priority",
      "Settings.items.recommendation-priority.title"
    );
    success("Settings.items.recommendation-priority.success");
  };

  return (
    <div className="view-settings">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (
            value === "search" ||
            value === "general" ||
            value === "account"
          ) {
            setActiveTab(value);
          }
        }}
        className="w-full"
      >
        <TabsList className="bg-muted/50 w-full justify-start gap-1 rounded-xl p-1">
          <TabsTrigger value="search" className="flex-none gap-1.5 rounded-lg">
            <Search className="icon-md" />
            {t("Settings.tabs.search")}
          </TabsTrigger>
          <TabsTrigger value="general" className="flex-none gap-1.5 rounded-lg">
            <Settings2 className="icon-md" />
            {t("Settings.tabs.general")}
          </TabsTrigger>
          <TabsTrigger value="account" className="flex-none gap-1.5 rounded-lg">
            <UserRound className="icon-md" />
            {t("Settings.tabs.account")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="mt-5">
          <div className="stack-5">
            <p className="text-muted-sm">{t("Settings.search.description")}</p>
            <div className="relative">
              <Search className="icon-md text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") recordSearch(query);
                }}
                placeholder={t("Settings.search.placeholder")}
                className="bg-muted/40 h-10 rounded-lg pl-9"
              />
            </div>

            {query.trim() ? (
              <div className="stack-1">
                {results.length ? (
                  results.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        recordSearch(query);
                        jumpTo(r.group);
                      }}
                      className="group hover:border-border hover:bg-accent/50 hover:text-accent-foreground flex items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-colors"
                    >
                      <Search className="icon-action" />
                      <span className="truncate">{t(r.labelKey)}</span>
                      <ChevronRight className="icon-sm text-muted-foreground/50 ml-auto shrink-0 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  ))
                ) : (
                  <div className="border-border text-muted-sm rounded-lg border border-dashed px-3 py-6 text-center">
                    {t("Settings.search.empty")}
                  </div>
                )}
              </div>
            ) : (
              <div className="stack-5">
                {history.length || changed.length ? (
                  <>
                    {history.length ? (
                      <div className="stack-2">
                        <div className="row-label">
                          <Clock className="icon-sm" />
                          {t("Settings.search.history")}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {history.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setQuery(s)}
                              className="border-border/60 bg-muted/60 hover:border-primary/40 hover:bg-accent hover:text-accent-foreground rounded-full border px-2.5 py-1 text-xs transition-colors"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {changed.length ? (
                      <div className="stack-2">
                        <div className="row-label">
                          <History className="icon-sm" />
                          {t("Settings.search.changed")}
                        </div>
                        <div className="stack-1">
                          {changed.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => jumpTo(r.group)}
                              className="group hover:bg-accent/50 hover:text-accent-foreground flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors"
                            >
                              <CheckCircle2 className="icon-action" />
                              <span className="truncate">{r.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearHistory}
                      className="text-muted-foreground self-start"
                    >
                      <Trash2 className="icon-md" />
                      {t("Settings.search.clear")}
                    </Button>
                  </>
                ) : (
                  <div className="border-border flex flex-col items-center gap-2 rounded-lg border border-dashed px-3 py-10 text-center">
                    <Search className="text-muted-foreground/60 h-5 w-5" />
                    <p className="text-muted-sm">
                      {t("Settings.search.noHistory")}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="general" className="mt-5">
          <div className="flex flex-col gap-4">
            <p className="text-muted-sm">{t("Settings.general.description")}</p>
            <SettingItemGroup
              title={t("Settings.danmaku.title")}
              description={t("Settings.danmaku.description")}
            >
              <div className="border-border/60 bg-card/55 rounded-lg border p-4">
                <DanmakuSettingsPanel />
              </div>
            </SettingItemGroup>
            <SettingInputItem
              type="text"
              value={title ?? ""}
              placeholder={t("Settings.items.title.placeholder")}
              onItemSubmit={titleAction}
              title={t("Settings.items.title.title")}
              description={t("Settings.items.title.description")}
              autoComplete={autoComplete}
            />
            <SettingSelectItem
              items={langItems}
              value={langItems.find((i) => i.value === lang)}
              label={t("Settings.items.lang.label")}
              placeholder={t("Settings.items.select.default.placeholder")}
              onItemSubmit={langAction}
              title={t("Settings.items.lang.title")}
              description={t("Settings.items.lang.description")}
            />
            <SettingSelectItem
              items={recommendationItems}
              value={recommendationItems.find(
                (item) => item.value === recommendationPriority
              )}
              label={t("Settings.items.recommendation-priority.label")}
              placeholder={t("Settings.items.select.default.placeholder")}
              onItemSubmit={recommendationAction}
              title={t("Settings.items.recommendation-priority.title")}
              description={t(
                "Settings.items.recommendation-priority.description"
              )}
            />
            <SettingOptionalItem
              label={t("Settings.items.auto-complete.label")}
              value={autoComplete}
              id="optional.auto-complete"
              onItemChange={autoCompleteAction}
              title={t("Settings.items.auto-complete.title")}
              description={t("Settings.items.auto-complete.description")}
            />
          </div>
        </TabsContent>

        <TabsContent value="account" className="mt-5">
          <AccountCenter />
        </TabsContent>
      </Tabs>
    </div>
  );
}
