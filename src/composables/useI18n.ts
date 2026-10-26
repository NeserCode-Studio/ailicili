import { useState, useContext, useCallback } from "react";
import { I18nTexts } from "../lib/i18n.resource";
import { I18nContext } from "@/contexts/i18n";
import { createLogger } from "@/lib/logger";

const log = createLogger("I18n");

// 自定义 Hook：封装语言逻辑
export function useI18nLogic() {
  const [lang, setLang] = useState<string>(
    localStorage.getItem("app-language") || "zh-CN"
  );

  const t = useCallback(
    (
      meaning: string,
      variables?: Record<string, string | number>
    ) => {
      const texts =
        I18nTexts[lang as keyof typeof I18nTexts] || I18nTexts["zh-CN"];
      const hit = texts[meaning as keyof typeof texts];
      // 未命中时回退返回 key 本身；这属于开发期问题，需要留痕
      if (!hit) log.warn("missing i18n key", meaning, `lang=${lang}`);
      return Object.entries(variables ?? {}).reduce(
        (text, [name, value]) =>
          text.split(`{${name}}`).join(String(value)),
        hit || meaning
      );
    },
    [lang]
  );

  const setLanguage = useCallback((newLang: string) => {
    if (!Object.keys(I18nTexts).includes(newLang)) {
      log.warn("setLanguage: unsupported language", newLang);
      return;
    }
    log.info("language changed", newLang);
    setLang(newLang);
    localStorage.setItem("app-language", newLang);
  }, []);

  return { lang, t, setLanguage };
}

// 自定义 Hook 获取语言上下文
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
