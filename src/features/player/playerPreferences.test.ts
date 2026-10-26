import { beforeEach, describe, expect, it } from "vitest";

import {
  createDefaultPlayerPreferences,
  readPlayerPreferences,
} from "@/features/player/playerPreferences";

describe("player preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns sanitized defaults when stored preferences are malformed", () => {
    localStorage.setItem(
      "ailicili:player-preferences",
      JSON.stringify({
        speed: 99,
        quality: "",
        autoPlay: "yes",
        danmaku: {
          opacity: "opaque",
          fontScale: null,
          modes: ["rolling"],
          density: "dense",
          fontWeight: 950,
        },
      })
    );

    expect(readPlayerPreferences()).toEqual(createDefaultPlayerPreferences());
  });
});
