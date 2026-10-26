import type { QueryClient } from "@tanstack/react-query";

import { biliKeys } from "@/lib/bili";

const ACCOUNT_SCOPED_ROOTS = new Set([
  "actions",
  "dynamic",
  "favorites",
  "history",
  "resume",
  "watch-later",
]);

export function clearAccountScopedQueries(queryClient: QueryClient) {
  queryClient.removeQueries({
    predicate: (query) =>
      query.queryKey[0] === biliKeys.all[0] &&
      typeof query.queryKey[1] === "string" &&
      ACCOUNT_SCOPED_ROOTS.has(query.queryKey[1]),
  });
}
