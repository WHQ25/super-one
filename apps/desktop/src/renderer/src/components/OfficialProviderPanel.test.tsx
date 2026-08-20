/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OfficialProviderPanel } from "./OfficialProviderPanel";

const codexGetAccountStatus = vi.fn();
const codexGetAuthStatus = vi.fn();

vi.mock("@/stores/chat", () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      activeProject: "/project",
      harnessResources: { claude: null },
    }),
}));

vi.mock("./ProviderLabel", () => ({
  ProviderLabel: () => <span>OpenAI</span>,
}));

Object.defineProperty(window, "app", {
  configurable: true,
  value: new Proxy(
    { codexGetAccountStatus, codexGetAuthStatus },
    {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return () => Promise.resolve(null);
      },
    },
  ),
});

describe("Codex provider account status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codexGetAccountStatus.mockResolvedValue({
      signedIn: false,
      authMode: null,
      email: null,
      planType: null,
      requiresOpenaiAuth: true,
    });
  });

  it("does not treat the default ChatGPT preference as a signed-in account", async () => {
    codexGetAuthStatus.mockResolvedValue({
      mode: "auto",
      resolvedMode: "chatgpt",
      hasEnvApiKey: false,
      hasSessionApiKey: false,
      isRunning: false,
    });

    render(<OfficialProviderPanel harness="codex" />);

    expect(await screen.findByText(/not signed in/i)).toBeInTheDocument();
    expect(screen.queryByText("ChatGPT")).toBeNull();
  });

  it("still reports a configured API key when no ChatGPT account is present", async () => {
    codexGetAuthStatus.mockResolvedValue({
      mode: "apiKey",
      resolvedMode: "apiKey",
      hasEnvApiKey: false,
      hasSessionApiKey: true,
      isRunning: false,
    });

    render(<OfficialProviderPanel harness="codex" />);

    expect(await screen.findByText("API Key")).toBeInTheDocument();
    expect(screen.queryByText(/not signed in/i)).toBeNull();
  });
});
