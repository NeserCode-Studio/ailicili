import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebounce } from "ahooks";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock3,
  LoaderCircle,
  Radio,
  Search,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";

import AsyncErrorState from "@/components/feedback/AsyncErrorState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/composables";
import SearchResultItem from "@/features/search/SearchResultItem";
import {
  addSearchHistory,
  clearSearchHistory,
  readSearchHistory,
} from "@/features/search/searchHistory";
import {
  biliKeys,
  fetchSearchSuggestions,
  normalizeBiliError,
  searchBili,
} from "@/lib/bili";
import { cn } from "@/lib/utils";
import type { SearchKind } from "@/shared/bili.types";

const SEARCH_KINDS: SearchKind[] = ["video", "user", "pgc", "live"];

const SEARCH_TYPE_META = {
  video: { icon: Video, label: "Search.type.video" },
  user: { icon: Users, label: "Search.type.user" },
  pgc: { icon: Clapperboard, label: "Search.type.pgc" },
  live: { icon: Radio, label: "Search.type.live" },
} satisfies Record<SearchKind, { icon: typeof Video; label: string }>;

function SearchResultsSkeleton() {
  return (
    <div className="space-y-3" data-testid="search-loading">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="grid gap-4 p-3 sm:grid-cols-[11rem_1fr]">
          <Skeleton className="aspect-video rounded-md" />
          <div className="flex flex-col justify-center gap-3">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SearchPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const rawKind = searchParams.get("type");
  const kind: SearchKind = SEARCH_KINDS.includes(rawKind as SearchKind)
    ? (rawKind as SearchKind)
    : "video";
  const parsedPage = Number(searchParams.get("page") ?? "1");
  const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const [input, setInput] = useState(query);
  const [history, setHistory] = useState(readSearchHistory);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const debouncedInput = useDebounce(input.trim(), { wait: 250 });

  useEffect(() => {
    setInput(query);
  }, [query]);

  useEffect(() => {
    if (!query) return;
    setHistory(addSearchHistory(query));
  }, [query]);

  const searchQuery = useQuery({
    queryKey: biliKeys.search(query, kind, page),
    queryFn: () => searchBili(query, kind, page),
    enabled: query.length > 0,
  });
  const suggestionsQuery = useQuery({
    queryKey: biliKeys.searchSuggestions(debouncedInput),
    queryFn: () => fetchSearchSuggestions(debouncedInput),
    enabled:
      suggestionsOpen && debouncedInput.length >= 2 && debouncedInput !== query,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const suggestions = suggestionsQuery.data ?? [];
  const visibleHistory =
    input.trim().length === 0 ? history : history.slice(0, 4);
  const dropdownItems =
    input.trim().length >= 2
      ? suggestions.map((suggestion) => suggestion.value)
      : visibleHistory;

  const setUrlState = useCallback(
    (next: { query?: string; kind?: SearchKind; page?: number }) => {
      const params = new URLSearchParams(searchParams);
      const nextQuery = (next.query ?? query).trim();
      const nextKind = next.kind ?? kind;
      const nextPage = next.page ?? page;
      if (nextQuery) {
        params.set("q", nextQuery);
      } else {
        params.delete("q");
      }
      params.set("type", nextKind);
      if (nextPage > 1) {
        params.set("page", String(nextPage));
      } else {
        params.delete("page");
      }
      setSearchParams(params, { replace: true });
    },
    [kind, page, query, searchParams, setSearchParams]
  );

  function runSearch(value = input, nextKind = kind) {
    const normalized = value.trim();
    if (!normalized) return;
    setInput(normalized);
    setHistory(addSearchHistory(normalized));
    setSuggestionsOpen(false);
    setUrlState({ query: normalized, kind: nextKind, page: 1 });
  }

  function chooseHistory(value: string) {
    runSearch(value);
  }

  function clearHistory() {
    clearSearchHistory();
    setHistory([]);
  }

  const error = searchQuery.error
    ? normalizeBiliError(searchQuery.error)
    : undefined;
  const errorDescription =
    error?.code === "risk_control"
      ? t("Search.error.riskControl")
      : t("Search.error.description");

  const resultCount = searchQuery.data?.total ?? 0;
  const tabs = useMemo(
    () =>
      SEARCH_KINDS.map((value) => ({
        value,
        ...SEARCH_TYPE_META[value],
      })),
    []
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-7 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Search.title")}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("Search.description")}
        </p>
      </header>

      <div className="relative mt-6 max-w-3xl">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            runSearch();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                setSuggestionsOpen(true);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onBlur={() => setSuggestionsOpen(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSuggestionsOpen(false);
              }}
              role="combobox"
              aria-expanded={suggestionsOpen && dropdownItems.length > 0}
              aria-controls="search-suggestions"
              aria-autocomplete="list"
              autoComplete="off"
              maxLength={100}
              placeholder={t("Search.placeholder")}
              className="pr-9 pl-9"
            />
            {input && (
              <button
                type="button"
                aria-label={t("Search.clearInput")}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setInput("");
                  setSuggestionsOpen(true);
                }}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Button type="submit" disabled={!input.trim()}>
            <Search className="size-4" />
            {t("Search.submit")}
          </Button>
        </form>

        {suggestionsOpen &&
          (dropdownItems.length > 0 ||
            (input.trim().length >= 2 && suggestionsQuery.isFetching)) && (
            <div
              id="search-suggestions"
              role="listbox"
              className="bg-popover text-popover-foreground absolute top-full right-0 left-0 z-30 mt-2 overflow-hidden rounded-md border p-1 shadow-lg"
            >
              {input.trim().length < 2 && history.length > 0 && (
                <div className="text-muted-foreground flex items-center justify-between px-2 py-1.5 text-[11px] font-medium">
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="size-3" />
                    {t("Search.history")}
                  </span>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={clearHistory}
                    className="hover:text-foreground flex items-center gap-1"
                  >
                    <Trash2 className="size-3" />
                    {t("Search.clearHistory")}
                  </button>
                </div>
              )}
              {dropdownItems.map((value) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  key={value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseHistory(value)}
                  className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm"
                >
                  <Search className="text-muted-foreground size-3.5" />
                  <span className="truncate">{value}</span>
                </button>
              ))}
              {suggestionsQuery.isFetching && (
                <div className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-xs">
                  <LoaderCircle className="size-3 animate-spin" />
                  {t("Search.suggestionsLoading")}
                </div>
              )}
            </div>
          )}
      </div>

      <Tabs
        className="mt-6"
        value={kind}
        onValueChange={(value) => {
          const nextKind = value as SearchKind;
          setUrlState({ kind: nextKind, page: 1 });
        }}
      >
        <TabsList
          aria-label={t("Search.types")}
          className="h-10 w-full justify-start sm:w-fit"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="min-w-20 px-3"
              >
                <Icon className="size-3.5" />
                {t(tab.label)}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {!query ? (
        <section className="border-border mt-7 border-t py-10">
          <div className="grid gap-8 md:grid-cols-[14rem_1fr]">
            <div>
              <p className="text-sm font-medium">{t("Search.start.title")}</p>
              <p className="text-muted-foreground mt-2 text-xs leading-5">
                {t("Search.start.description")}
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">{t("Search.history")}</h2>
                {history.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearHistory}>
                    <Trash2 className="size-3.5" />
                    {t("Search.clearHistory")}
                  </Button>
                )}
              </div>
              {history.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {history.map((value) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => chooseHistory(value)}
                      className="border-border hover:bg-muted rounded-md border px-3 py-2 text-left text-sm transition-colors"
                    >
                      {value}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground mt-3 text-sm">
                  {t("Search.historyEmpty")}
                </p>
              )}
            </div>
          </div>
        </section>
      ) : searchQuery.isPending ? (
        <div className="mt-7">
          <SearchResultsSkeleton />
        </div>
      ) : error ? (
        <div className="mt-7">
          <AsyncErrorState
            title={t("Search.error.title")}
            description={errorDescription}
            code={error.code}
            retryLabel={t("Search.retry")}
            onRetry={() => void searchQuery.refetch()}
          />
          {error.code === "risk_control" && (
            <p className="text-muted-foreground mt-3 text-center text-xs">
              <Link
                to="/login"
                className="text-primary underline-offset-4 hover:underline"
              >
                {t("Search.error.signIn")}
              </Link>
            </p>
          )}
        </div>
      ) : searchQuery.data?.items.length === 0 ? (
        <div className="border-border mt-7 flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
          <Search className="text-muted-foreground size-6" />
          <div>
            <h2 className="text-base font-semibold">
              {t("Search.empty.title")}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("Search.empty.description")}
            </p>
          </div>
        </div>
      ) : (
        <section className="mt-7" aria-label={t("Search.results")}>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-muted-foreground text-xs">
              {t("Search.resultCount", { count: resultCount })}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("Search.page", { page })}
            </p>
          </div>
          <div
            className={cn(
              "divide-border divide-y transition-opacity",
              searchQuery.isFetching && "opacity-60"
            )}
          >
            {searchQuery.data?.items.map((item) => (
              <SearchResultItem
                key={
                  item.kind === "video"
                    ? `video-${item.bvid}`
                    : item.kind === "user"
                      ? `user-${item.mid}`
                      : item.kind === "pgc"
                        ? `pgc-${item.seasonId}`
                        : `live-${item.roomId}`
                }
                item={item}
              />
            ))}
          </div>
          <nav
            className="mt-8 flex items-center justify-center gap-3"
            aria-label={t("Search.pagination")}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || searchQuery.isFetching}
              onClick={() => setUrlState({ page: page - 1 })}
            >
              <ChevronLeft className="size-4" />
              {t("Search.previous")}
            </Button>
            <span className="text-muted-foreground min-w-14 text-center text-xs tabular-nums">
              {page}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!searchQuery.data?.hasMore || searchQuery.isFetching}
              onClick={() => setUrlState({ page: page + 1 })}
            >
              {t("Search.next")}
              <ChevronRight className="size-4" />
            </Button>
          </nav>
        </section>
      )}
    </div>
  );
}
