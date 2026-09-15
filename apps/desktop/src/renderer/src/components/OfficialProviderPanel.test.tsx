/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OfficialProviderPanel } from "./OfficialProviderPanel";

const claudeListAccounts = vi.fn();
const codexListAccounts = vi.fn();

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
    { claudeListAccounts, codexListAccounts },
    {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return () => Promise.resolve(null);
      },
    },
  ),
});

// The panel only dispatches on harness; account behaviour lives with
// ClaudeAccountsPanel / CodexAuthSettings and their own tests.
describe("OfficialProviderPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claudeListAccounts.mockResolvedValue([]);
    codexListAccounts.mockResolvedValue([]);
  });

  it("renders the Claude account list for the claude harness", async () => {
    render(<OfficialProviderPanel harness="claude" />);

    expect(await screen.findByText(/not signed in/i)).toBeInTheDocument();
    expect(claudeListAccounts).toHaveBeenCalled();
    expect(codexListAccounts).not.toHaveBeenCalled();
  });

  it("renders the ChatGPT account manager for the codex harness", async () => {
    render(<OfficialProviderPanel harness="codex" />);

    expect(await screen.findByRole("region", { name: "ChatGPT Accounts" })).toBeInTheDocument();
    expect(codexListAccounts).toHaveBeenCalledWith("/project");
    expect(claudeListAccounts).not.toHaveBeenCalled();
  });
});
