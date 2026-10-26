import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nContext } from "@/contexts/i18n";
import LoginPage from "@/features/auth/LoginPage";
import {
  fetchAuthStatus,
  pollQrLogin,
  startQrLogin,
} from "@/lib/bili";

vi.mock("@/lib/bili", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/bili")>("@/lib/bili");
  return {
    ...actual,
    fetchAuthStatus: vi.fn(),
    startQrLogin: vi.fn(),
    pollQrLogin: vi.fn(),
  };
});

const fetchAuthStatusMock = vi.mocked(fetchAuthStatus);
const startQrLoginMock = vi.mocked(startQrLogin);
const pollQrLoginMock = vi.mocked(pollQrLogin);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <I18nContext.Provider
        value={{
          lang: "zh-CN",
          setLang: () => {},
          t: (key) => key,
        }}
      >
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </I18nContext.Provider>
    </QueryClientProvider>
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    fetchAuthStatusMock.mockReset();
    startQrLoginMock.mockReset();
    pollQrLoginMock.mockReset();
  });

  it("renders a locally created QR code for a guest", async () => {
    fetchAuthStatusMock.mockResolvedValue({
      authenticated: false,
      storageAvailable: true,
      profile: null,
    });
    startQrLoginMock.mockResolvedValue({
      attemptId: "attempt-1",
      qrSvg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
      expiresInSeconds: 180,
    });
    pollQrLoginMock.mockResolvedValue({
      state: "expired",
      profile: null,
    });

    renderPage();

    expect(await screen.findByAltText("Auth.qr.alt")).toBeVisible();
    expect(startQrLoginMock).toHaveBeenCalledOnce();
  });

  it("shows account identity for an authenticated user", async () => {
    fetchAuthStatusMock.mockResolvedValue({
      authenticated: true,
      storageAvailable: true,
      profile: {
        mid: "42",
        name: "测试用户",
        avatarUrl: "https://i0.hdslb.com/avatar.jpg",
        level: 6,
        vipStatus: false,
        vipLabel: null,
      },
    });

    renderPage();

    expect(await screen.findByText("测试用户")).toBeVisible();
    expect(screen.getByText("UID 42")).toBeVisible();
    expect(startQrLoginMock).not.toHaveBeenCalled();
  });

  it("offers a retry when account status cannot be loaded", async () => {
    fetchAuthStatusMock.mockRejectedValue({
      code: "network_error",
      message: "offline",
    });

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Auth.statusError.title"
    );
    expect(screen.getByRole("button", { name: "Auth.retry" })).toBeVisible();
  });
});
