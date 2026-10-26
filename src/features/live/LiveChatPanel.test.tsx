import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nContext } from "@/contexts/i18n";
import LiveChatPanel from "@/features/live/LiveChatPanel";
import {
  pollLiveChat,
  startLiveChat,
  stopLiveChat,
} from "@/lib/bili";
import { createLiveChatMessage } from "@/test/fixtures/bili";

vi.mock("@/lib/bili", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bili")>();
  return {
    ...actual,
    pollLiveChat: vi.fn(),
    startLiveChat: vi.fn(),
    stopLiveChat: vi.fn(),
  };
});

const startLiveChatMock = vi.mocked(startLiveChat);
const pollLiveChatMock = vi.mocked(pollLiveChat);
const stopLiveChatMock = vi.mocked(stopLiveChat);

describe("LiveChatPanel", () => {
  beforeEach(() => {
    startLiveChatMock.mockReset();
    pollLiveChatMock.mockReset();
    stopLiveChatMock.mockReset();
    startLiveChatMock
      .mockResolvedValueOnce({ sessionId: "chat-session-1" })
      .mockResolvedValueOnce({ sessionId: "chat-session-2" });
    pollLiveChatMock.mockResolvedValue({
      messages: [
        createLiveChatMessage({
          id: "chat-message",
          username: "观众甲",
          text: "晚上好",
        }),
      ],
      cursor: 1,
      connected: true,
      error: null,
    });
    stopLiveChatMock.mockResolvedValue();
  });

  it("starts, polls, and stops chat sessions with player visibility", async () => {
    const view = render(
      <I18nContext.Provider
        value={{
          lang: "zh-CN",
          setLang: () => {},
          t: (key) => key,
        }}
      >
        <LiveChatPanel roomId={123} active />
      </I18nContext.Provider>
    );

    expect(await screen.findByText("晚上好")).toBeVisible();
    expect(startLiveChatMock).toHaveBeenCalledWith(123);
    expect(pollLiveChatMock).toHaveBeenCalledWith("chat-session-1", 0);
    expect(screen.getByText("Live.chat.status.connected")).toBeVisible();

    view.rerender(
      <I18nContext.Provider
        value={{
          lang: "zh-CN",
          setLang: () => {},
          t: (key) => key,
        }}
      >
        <LiveChatPanel roomId={123} active={false} />
      </I18nContext.Provider>
    );
    await waitFor(() =>
      expect(stopLiveChatMock).toHaveBeenCalledWith("chat-session-1")
    );

    view.rerender(
      <I18nContext.Provider
        value={{
          lang: "zh-CN",
          setLang: () => {},
          t: (key) => key,
        }}
      >
        <LiveChatPanel roomId={123} active />
      </I18nContext.Provider>
    );
    await waitFor(() => expect(startLiveChatMock).toHaveBeenCalledTimes(2));
    expect(startLiveChatMock).toHaveBeenLastCalledWith(123);
  });
});
