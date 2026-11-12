import { createContext, useContext } from "react";

export interface TitleContextValue {
  title?: string;
  setTitle: (newTitle: string) => void;
}

export const TitleContext = createContext<TitleContextValue>({
  title: "ailicili",
  setTitle: () => {},
});

export function useTitleContext() {
  return useContext(TitleContext);
}
