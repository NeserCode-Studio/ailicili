import { useCallback, useEffect, useState } from "react";
import { RefreshCw, AlertCircle, Search } from "lucide-react";

import {
  getPopularVideos,
  searchVideos,
  type VideoCard as VideoCardModel,
} from "@/api/media";
import { Input } from "@/components/ui/input";
import VideoCard from "@/components/media/VideoCard";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/composables";
import { createLogger } from "@/lib/logger";

const log = createLogger("Media/Home");

export default function Home() {
  const { t } = useI18n();
  const [items, setItems] = useState<VideoCardModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPopularVideos();
      log.info("popular loaded", {
        count: result.items.length,
        first: result.items[0]?.videoId,
        firstCover: result.items[0]?.coverUrl,
      });
      setItems(result.items);
    } catch (err) {
      log.error("popular failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const search = useCallback(async () => {
    const query = keyword.trim();
    if (!query) {
      void load();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await searchVideos(query);
      log.info("search loaded", { keyword: query, count: result.items.length });
      setItems(result.items);
    } catch (err) {
      log.error("search failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [keyword, load]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="view-home">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <h1 className="text-lg font-semibold">{t("Home.title")}</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void search();
              }}
              placeholder={t("Home.search.placeholder")}
              className="w-64 pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => void search()} disabled={loading}>
            <Search className={loading ? "animate-pulse" : ""} />
            {t("Home.search")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {t("Home.retry")}
          </Button>
        </div>
      </header>
      {loading ? (
        <div className="p-8 text-muted-sm">{t("Home.loading")}</div>
      ) : error ? (
        <div className="stack-3 items-start p-8">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="icon-md" />
            {t("Home.error")}
          </div>
          <p className="text-muted-xs">{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 text-muted-sm">{t("Home.empty")}</div>
      ) : (
        <div className="video-grid">
          {items.map((video, index) => (
            <VideoCard key={`${video.videoId}-${index}`} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}
