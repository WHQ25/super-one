/** @vitest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexAuthSettings } from "./CodexAuthSettings";

const codexGetAccountStatus = vi.fn();
const codexStartAccountLogin = vi.fn();
const codexCancelAccountLogin = vi.fn();
const codexLogoutAccount = vi.fn();

vi.mock("@/stores/chat", () => ({
  useChatStore: (selector: (state: { activeProject: string }) => unknown) =>
    selector({ activeProject: "/project" }),
}));

Object.defineProperty(window, "app", {
  configurable: true,
  value: new Proxy(
    {
      codexGetAccountStatus,
      codexStartAccountLogin,
      codexCancelAccountLogin,
      codexLogoutAccount,
    },
    {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return () => Promise.resolve(undefined);
      },
    },
  ),
});

describe("Codex ChatGPT account settings", () => {
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

  it("starts device-code login and displays the code returned by the remote node", async () => {
    codexStartAccountLogin.mockResolvedValue({
      type: "chatgptDeviceCode",
      loginId: "login-1",
      verificationUrl: "https://auth.openai.com/device",
      userCode: "ABCD-EFGH",
    });
    const user = userEvent.setup();
    render(<CodexAuthSettings />);

    await user.click(
      await screen.findByRole("button", { name: "Sign in with ChatGPT" }),
    );

    expect(codexStartAccountLogin).toHaveBeenCalledWith("/project");
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(screen.getByText("Enter this one-time code")).toBeInTheDocument();
  });

  it("shows signed-out actions in a single account card", async () => {
    render(<CodexAuthSettings />);

    await waitFor(() => expect(codexGetAccountStatus).toHaveBeenCalled());
    const accountCard = screen.getByRole("region", {
      name: "ChatGPT account",
    });

    expect(
      within(accountCard).getByRole("button", {
        name: "Sign in with ChatGPT",
      }),
    ).toBeInTheDocument();
    expect(within(accountCard).queryByText("Not signed in")).toBeNull();
  });

  it("shows the real account and signs it out", async () => {
    codexGetAccountStatus.mockResolvedValue({
      signedIn: true,
      authMode: "chatgpt",
      email: "dev@example.com",
      planType: "pro",
      requiresOpenaiAuth: true,
    });
    codexLogoutAccount.mockResolvedValue({
      signedIn: false,
      authMode: null,
      email: null,
      planType: null,
      requiresOpenaiAuth: true,
    });
    const user = userEvent.setup();
    render(<CodexAuthSettings />);

    expect(await screen.findByText("dev@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Signed in")).toBeNull();
    expect(screen.queryByText("Authentication")).toBeNull();
    const accountHeader = screen.getByRole("banner");
    await user.click(
      within(accountHeader).getByRole("button", { name: "Sign out" }),
    );

    await waitFor(() =>
      expect(codexLogoutAccount).toHaveBeenCalledWith("/project"),
    );
    expect(
      screen.getByRole("button", { name: "Sign in with ChatGPT" }),
    ).toBeInTheDocument();
  });
});
