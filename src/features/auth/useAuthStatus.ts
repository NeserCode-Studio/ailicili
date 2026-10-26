import { useQuery } from "@tanstack/react-query";

import { biliKeys, fetchAuthStatus } from "@/lib/bili";

export function useAuthStatus() {
  return useQuery({
    queryKey: biliKeys.auth(),
    queryFn: fetchAuthStatus,
    staleTime: 60 * 1000,
  });
}
