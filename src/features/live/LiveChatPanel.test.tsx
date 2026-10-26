import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nContext } from "@/contexts/i18n";
import LiveChatPanel from "@/features/live/LiveChatPanel";
import { pollLiveChat, startLiveChat, stopLiveChat } from "@/lib/bili";
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

  it("follows new messages only while the reader is near the bottom", async () => {
    vi.useFakeTimers();
    pollLiveChatMock
      .mockReset()
      .mockResolvedValueOnce({
        messages: [
          createLiveChatMessage({ id: "message-1", text: "第一条消息" }),
        ],
        cursor: 1,
        connected: true,
        error: null,
      })
      .mockResolvedValueOnce({
        messages: [
          createLiveChatMessage({ id: "message-2", text: "第二条消息" }),
        ],
        cursor: 2,
        connected: true,
        error: null,
      })
      .mockResolvedValueOnce({
        messages: [
          createLiveChatMessage({ id: "message-3", text: "第三条消息" }),
        ],
        cursor: 3,
        connected: true,
        error: null,
      })
      .mockResolvedValueOnce({
        messages: [
          createLiveChatMessage({ id: "message-4", text: "第四条消息" }),
        ],
        cursor: 4,
        connected: true,
        error: null,
      });

    try {
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
      const viewport = view.container.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]'
      );
      expect(viewport).not.toBeNull();
      Object.defineProperties(viewport as HTMLElement, {
        clientHeight: { configurable: true, value: 200 },
        scrollHeight: { configurable: true, value: 500 },
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("第一条消息")).toBeVisible();
      expect(viewport?.scrollTop).toBe(300);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_200);
      });
      expect(screen.getByText("第二条消息")).toBeVisible();
      expect(viewport?.scrollTop).toBe(300);

      if (viewport) {
        viewport.scrollTop = 120;
        fireEvent.scroll(viewport);
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_200);
      });
      expect(screen.getByText("第三条消息")).toBeVisible();
      expect(viewport?.scrollTop).toBe(120);

      if (viewport) {
        viewport.scrollTop = 285;
        fireEvent.scroll(viewport);
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_200);
      });
      expect(screen.getByText("第四条消息")).toBeVisible();
      expect(viewport?.scrollTop).toBe(300);
    } finally {
      vi.useRealTimers();
    }
  });
});
