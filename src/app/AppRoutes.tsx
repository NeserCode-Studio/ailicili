import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router";
import { LoaderCircle } from "lucide-react";

import { useI18n } from "@/composables";

const DiscoveryPage = lazy(() => import("@/features/discovery/DiscoveryPage"));
const VideoDetailPage = lazy(() => import("@/features/video/VideoDetailPage"));
const PgcCatalogPage = lazy(() => import("@/features/pgc/PgcCatalogPage"));
const PgcSeasonPage = lazy(() => import("@/features/pgc/PgcSeasonPage"));
const LiveCatalogPage = lazy(() => import("@/features/live/LiveCatalogPage"));
const LivePlayerPage = lazy(() => import("@/features/live/LivePlayerPage"));
const DownloadsPage = lazy(() => import("@/features/downloads/DownloadsPage"));
const PlayerWindowPage = lazy(
  () => import("@/features/player/PlayerWindowPage")
);
const LoginPage = lazy(() => import("@/features/auth/LoginPage"));
const SearchPage = lazy(() => import("@/features/search/SearchPage"));
const LibraryPage = lazy(() => import("@/features/library/LibraryPage"));
const DynamicFeedPage = lazy(
  () => import("@/features/dynamics/DynamicFeedPage")
);
const SpacePage = lazy(() => import("@/features/space/SpacePage"));
const Framework = lazy(() => import("@/views/Framework"));

function RouteLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <LoaderCircle className="text-muted-foreground size-5 animate-spin" />
    </div>
  );
}

function NotFound() {
  const { t } = useI18n();

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-8 text-center">
      <p className="text-5xl font-semibold tracking-tight">404</p>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{t("Route.notFound.title")}</h1>
        <p className="text-muted-foreground text-sm">
          {t("Route.notFound.description")}
        </p>
      </div>
      <Link
        to="/"
        className="text-primary text-sm font-medium underline-offset-4 hover:underline"
      >
        {t("Nav.discover")}
      </Link>
    </div>
  );
}

export default function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<DiscoveryPage />} />
        <Route path="/video/:bvid" element={<VideoDetailPage />} />
        <Route path="/pgc" element={<PgcCatalogPage />} />
        <Route path="/pgc/:seasonId" element={<PgcSeasonPage />} />
        <Route path="/live" element={<LiveCatalogPage />} />
        <Route path="/downloads" element={<DownloadsPage />} />
        <Route path="/player/live/:roomId" element={<LivePlayerPage />} />
        <Route path="/player/:bvid/:cid" element={<PlayerWindowPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/dynamics" element={<DynamicFeedPage />} />
        <Route path="/space/:mid" element={<SpacePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/framework" element={<Framework />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
