import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { clearAccountScopedQueries } from "@/features/auth/accountQueries";
import { biliKeys } from "@/lib/bili";

describe("clearAccountScopedQueries", () => {
  it("removes account data while keeping public and auth queries", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(biliKeys.actions("BV1xx411c7mD"), {
      liked: true,
    });
    queryClient.setQueryData(biliKeys.watchLater(), { videos: [] });
    queryClient.setQueryData(biliKeys.video("BV1xx411c7mD"), { title: "video" });
    queryClient.setQueryData(biliKeys.auth(), { authenticated: true });

    clearAccountScopedQueries(queryClient);

    expect(
      queryClient.getQueryData(biliKeys.actions("BV1xx411c7mD"))
    ).toBeUndefined();
    expect(queryClient.getQueryData(biliKeys.watchLater())).toBeUndefined();
    expect(queryClient.getQueryData(biliKeys.video("BV1xx411c7mD"))).toEqual({
      title: "video",
    });
    expect(queryClient.getQueryData(biliKeys.auth())).toEqual({
      authenticated: true,
    });
  });
});
