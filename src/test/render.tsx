import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { I18nContext } from "@/contexts/i18n";

export function renderWithProviders(
  children: ReactNode,
  { route = "/" }: { route?: string } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <I18nContext.Provider
          value={{
            lang: "zh-CN",
            setLang: () => {},
            t: (key, variables) =>
              variables ? `${key}:${Object.values(variables).join(",")}` : key,
          }}
        >
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </I18nContext.Provider>
      </QueryClientProvider>
    ),
  };
}
