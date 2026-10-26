import { createContext } from "react";

export interface I18nContextValue {
  lang: string;
  setLang: (lang: string) => void;
  t: (
    meaning: string,
    variables?: Record<string, string | number>
  ) => string;
}

export const I18nContext = createContext<I18nContextValue | undefined>(
  undefined
);
