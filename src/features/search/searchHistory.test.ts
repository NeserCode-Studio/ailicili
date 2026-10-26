import { beforeEach, describe, expect, it } from "vitest";

import {
  addSearchHistory,
  clearSearchHistory,
  readSearchHistory,
} from "@/features/search/searchHistory";

describe("search history", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the newest unique queries and limits the list", () => {
    for (let index = 0; index < 10; index += 1) {
      addSearchHistory(`query-${index}`);
    }
    addSearchHistory("query-5");

    const history = readSearchHistory();
    expect(history).toHaveLength(8);
    expect(history[0]).toBe("query-5");
    expect(new Set(history).size).toBe(history.length);
  });

  it("clears saved queries", () => {
    addSearchHistory("rust");
    clearSearchHistory();
    expect(readSearchHistory()).toEqual([]);
  });
});
