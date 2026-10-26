import { describe, expect, it } from "vitest";

import { I18nTexts } from "@/lib/i18n.resource";

function placeholders(value: string) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe("I18nTexts", () => {
  it("keeps English and Chinese translation keys aligned", () => {
    const english = Object.keys(I18nTexts["en-US"]).sort();
    const chinese = Object.keys(I18nTexts["zh-CN"]).sort();
    expect(english).toEqual(chinese);
  });

  it("preserves interpolation variables across locales", () => {
    for (const key of Object.keys(I18nTexts["en-US"])) {
      const typedKey = key as keyof (typeof I18nTexts)["en-US"];
      expect(placeholders(I18nTexts["en-US"][typedKey])).toEqual(
        placeholders(I18nTexts["zh-CN"][typedKey])
      );
    }
  });
});
