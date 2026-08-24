import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import type {
  SessionAgentLaunchProposal,
  SessionAgentProfile,
  SessionAgentRequestPayload,
} from "@superone/shared/agent-types";
import { SessionAgentsConfirmPrompt } from "./SessionAgentsConfirmPrompt";
import { ToolBlock } from "./ToolBlock";

/**
 * SuperOne session_collab_* MCP tool UI
 * (`session_collab_request` / `session_collab_start` / `session_collab_send` / `session_collab_retrieve`).
 */

const PREFIX = "mcp__superone__";
const PARENT_CWD = "/Users/me/projects/super-one";

const profiles: SessionAgentProfile[] = [
  {
    id: "claude-base",
    name: "Claude",
    harnessId: "claude",
    brandKey: "claude",
    defaultConfig: { model: "claude-sonnet", effort: "medium" },
    models: [
      { id: "claude-sonnet", name: "Claude Sonnet" },
      { id: "claude-opus", name: "Claude Opus" },
    ],
    efforts: ["low", "medium", "high"],
    apiProviders: [
      { id: "anthropic", name: "Anthropic" },
      { id: "relay", name: "Team Relay" },
    ],
  },
  {
    id: "codex-base",
    name: "Codex",
    harnessId: "codex",
    brandKey: "codex",
    defaultConfig: { model: "gpt-5.4", effort: "high" },
    models: [{ id: "gpt-5.4", name: "GPT-5.4" }],
    efforts: ["medium", "high", "xhigh"],
    apiProviders: [{ id: "openai", name: "OpenAI" }],
  },
  {
    id: "acp-base",
    name: "Grok",
    harnessId: "acp",
    acpAgentId: "grok-build",
    brandKey: "acp-grok",
    defaultConfig: { model: "grok-4.5", effort: "high" },
    models: [{ id: "grok-4.5", name: "Grok 4.5" }],
    efforts: ["low", "high"],
    apiProviders: [],
  },
  {
    id: "opencode-base",
    name: "OpenCode",
    harnessId: "opencode",
    brandKey: "opencode",
    defaultConfig: { model: "kimi-k2" },
    models: [{ id: "kimi-k2", name: "Kimi K2" }],
    efforts: [],
    apiProviders: [],
  },
];

function launch(
  launchId: string,
  agentId: string,
  summary: string,
  task: string,
  config: SessionAgentLaunchProposal["config"],
  opts: { name: string; role: string },
): SessionAgentLaunchProposal {
  const { name, role } = opts;
  return {
    launchId,
    mode: "spawn",
    agentId,
    summary,
    task,
    name,
    role,
    config: {
      cwd: PARENT_CWD,
      sandboxMode: "off",
      permissionMode: "default",
      name,
      role,
      ...config,
    },
  };
}

function linkLaunch(
  launchId: string,
  opts: {
    sessionId: string;
    summary: string;
    task?: string;
    peerTitle: string;
    peerProjectPath?: string;
    peerHarnessId: string;
    peerHarnessName: string;
    peerBrandKey?: string;
    peerAcpAgentId?: string;
    name?: string;
    role?: string;
  },
): SessionAgentLaunchProposal {
  const name = opts.name ?? opts.peerTitle;
  const role = opts.role ?? "Peer";
  return {
    launchId,
    mode: "link",
    agentId: "",
    sessionId: opts.sessionId,
    peerTitle: opts.peerTitle,
    peerProjectPath: opts.peerProjectPath ?? PARENT_CWD,
    peerHarnessId: opts.peerHarnessId,
    peerHarnessName: opts.peerHarnessName,
    ...(opts.peerBrandKey ? { peerBrandKey: opts.peerBrandKey } : {}),
    ...(opts.peerAcpAgentId ? { peerAcpAgentId: opts.peerAcpAgentId } : {}),
    summary: opts.summary,
    task: opts.task ?? "",
    name,
    role,
    config: { name, role },
  };
}

const permissionPayload: SessionAgentRequestPayload = {
  profiles,
  launches: [
    launch(
      "review-tests",
      "claude-base",
      "Review focused test failures",
      [
        "## Task",
        "Review the focused test failures and report the root cause.",
        "",
        "- Inspect the failing suite",
        "- List root causes with `file:line`",
        "- Do **not** edit files",
      ].join("\n"),
      { model: "claude-sonnet", effort: "medium", sandboxMode: "on" },
      { name: "DiffBot", role: "Reviewer" },
    ),
    launch(
      "inspect-types",
      "codex-base",
      "Classify typecheck errors",
      "Inspect the current typecheck errors and classify existing versus new failures.",
      {
        model: "gpt-5.4",
        effort: "high",
        permissionMode: "bypassPermissions",
        worktree: {
          enabled: true,
          baseBranch: "main",
          mode: "branch",
          branchName: "agent/typecheck-review",
        },
      },
      { name: "TypeBot", role: "Analyst" },
    ),
  ],
};

type PermissionPromptProps = {
  value?: SessionAgentRequestPayload;
  width?: number;
};

function SessionCollabRequestPermissionPrompt({
  value = permissionPayload,
  width = 680,
}: PermissionPromptProps) {
  const [result, setResult] = useState("");
  return (
    <div className="@container" style={{ width, maxWidth: "100%" }}>
      <SessionAgentsConfirmPrompt
        payload={value}
        onConfirm={(launches) => setResult(JSON.stringify(launches, null, 2))}
        onReject={() => setResult("rejected")}
      />
      {result && (
        <pre className="mx-3 whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-[10px]">
          {result}
        </pre>
      )}
    </div>
  );
}

function StoryShell({
  children,
  width = 560,
}: {
  children: ReactNode;
  width?: number;
}) {
  return (
    <div className="@container space-y-3" style={{ maxWidth: width }}>
      {children}
    </div>
  );
}

function block(
  tool: string,
  input: Record<string, unknown>,
  opts: {
    status?: "streaming" | "complete";
    result?: string;
    isError?: boolean;
    elapsedSeconds?: number;
  } = {},
) {
  return (
    <ToolBlock
      toolName={`${PREFIX}${tool}`}
      input={JSON.stringify(input)}
      status={opts.status ?? "complete"}
      result={opts.result}
      isError={opts.isError}
      elapsedSeconds={opts.elapsedSeconds}
    />
  );
}

const LAUNCHES_ONE = {
  launches: [
    {
      launchId: "reviewer",
      agentId: "acp-base",
      name: "DiffBot",
      role: "Reviewer",
      summary: "Review the diff (read-only)",
      task: "Review the diff and report issues only.",
    },
  ],
};

const LAUNCHES_TWO = {
  launches: [
    {
      launchId: "alpha",
      agentId: "claude-base",
      name: "Alice",
      role: "Reviewer",
      summary: "Review focused test failures",
      task: "Review the focused test failures and report the root cause.",
    },
    {
      launchId: "beta",
      agentId: "codex-base",
      name: "Bob",
      role: "Implementer",
      summary: "Implement the approved fix",
      task: "Implement the approved fix.",
    },
  ],
};

const CRED_A = "s1sc_demo_credential_aaaa";
const CRED_B = "s1sc_demo_credential_bbbb";

const START_RESULT = {
  status: "started",
  sessionId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  reused: false,
  name: "DiffBot",
  role: "Reviewer",
  title: "DiffBot - Reviewer",
  config: {
    model: "grok-4.5",
    effort: "high",
    permissionMode: "default",
    sandboxMode: "off",
    cwd: "/Users/me/projects/super-one",
    name: "DiffBot",
    role: "Reviewer",
  },
};

const meta: Meta = {
  title: "Tool UI/SuperOne MCP/Session",
  parameters: { layout: "padded" },
};

export default meta;
type Story = StoryObj;

function permissionPromptStory(
  name: string,
  props: PermissionPromptProps = {},
): Story {
  return {
    name: `session_collab_request · Permission Prompt · ${name}`,
    render: () => <SessionCollabRequestPermissionPrompt {...props} />,
  };
}

export const CollabListAgents: Story = {
  name: "session_collab_list_agents",
  render: () => (
    <StoryShell>
      {block(
        "session_collab_list_agents",
        {},
        { result: JSON.stringify({ agents: [] }) },
      )}
    </StoryShell>
  ),
};

export const CollabRequest: Story = {
  name: "session_collab_request",
  render: () => (
    <StoryShell>
      {block("session_collab_request", LAUNCHES_ONE, {
        status: "streaming",
        elapsedSeconds: 1,
      })}
      {block("session_collab_request", LAUNCHES_ONE, {
        result: JSON.stringify({
          status: "approved",
          launches: LAUNCHES_ONE.launches,
        }),
      })}
    </StoryShell>
  ),
};

export const MultipleAgents: Story = {
  name: "session_collab_request · Permission Prompt · multiple agents",
  ...permissionPromptStory("multiple agents"),
};

export const NarrowChat: Story = {
  name: "session_collab_request · Permission Prompt · narrow chat",
  ...permissionPromptStory("narrow chat", { width: 380 }),
};

export const NarrowManyAgents: Story = {
  name: "session_collab_request · Permission Prompt · narrow many agents",
  ...permissionPromptStory("narrow many agents", {
    width: 320,
    value: {
      profiles,
      launches: Array.from({ length: 5 }, (_, index) =>
        launch(
          `narrow-${index}`,
          index % 2 ? "codex-base" : "claude-base",
          `Task ${index + 1}`,
          `Task number ${index + 1}.`,
          { model: index % 2 ? "gpt-5.4" : "claude-sonnet" },
          { name: `Agent ${index + 1}`, role: "Worker" },
        ),
      ),
    },
  }),
};

export const SingleAgent: Story = {
  name: "session_collab_request · Permission Prompt · single agent",
  ...permissionPromptStory("single agent", {
    value: {
      ...permissionPayload,
      launches: permissionPayload.launches.slice(0, 1),
    },
  }),
};

export const EveryHarness: Story = {
  name: "session_collab_request · Permission Prompt · every harness",
  ...permissionPromptStory("every harness", {
    value: {
      profiles,
      launches: [
        launch(
          "h-claude",
          "claude-base",
          "Claude permission modes",
          "Claude runs the full permission-mode list.",
          { model: "claude-sonnet", permissionMode: "plan" },
          { name: "PlannerBot", role: "Planner" },
        ),
        launch(
          "h-codex",
          "codex-base",
          "Codex sandbox presets",
          "Codex shows sandbox presets instead of permission modes.",
          { model: "gpt-5.4", permissionMode: "bypassPermissions" },
          { name: "CoderBot", role: "Coder" },
        ),
        launch(
          "h-grok",
          "acp-base",
          "Grok ACP baselines",
          "Grok shows the ACP ask/plan/auto/always baselines.",
          { model: "grok-4.5", permissionMode: "auto" },
          { name: "DiffBot", role: "Reviewer" },
        ),
        launch(
          "h-opencode",
          "opencode-base",
          "OpenCode mode subset",
          "OpenCode shows only the modes its backend implements.",
          { model: "kimi-k2", permissionMode: "dontAsk" },
          { name: "Scout", role: "Explorer" },
        ),
      ],
    },
  }),
};

export const GrokRoles: Story = {
  name: "session_collab_request · Permission Prompt · Grok roles",
  ...permissionPromptStory("Grok roles", {
    value: {
      profiles,
      launches: [
        launch(
          "alpha",
          "acp-base",
          "Review the diff (read-only)",
          "You are Reviewer. Review the diff and report issues only.",
          { model: "grok-4.5" },
          { name: "DiffBot", role: "Reviewer" },
        ),
        launch(
          "beta",
          "acp-base",
          "Apply the approved fix",
          "You are Implementer. Apply the approved fix.",
          { model: "grok-4.5" },
          { name: "FixBot", role: "Implementer" },
        ),
      ],
    },
  }),
};

export const WorkingLocations: Story = {
  name: "session_collab_request · Permission Prompt · working locations",
  ...permissionPromptStory("working locations", {
    value: {
      profiles,
      launches: [
        launch(
          "loc-parent",
          "claude-base",
          "Parent working directory",
          "Runs in the parent session's own working directory — no worktree.",
          { model: "claude-sonnet" },
          { name: "ParentBot", role: "Worker" },
        ),
        launch(
          "loc-branch",
          "claude-base",
          "Fresh branch worktree",
          "Runs in a fresh worktree on a newly created branch.",
          {
            model: "claude-sonnet",
            worktree: {
              enabled: true,
              baseBranch: "main",
              mode: "branch",
              branchName: "agent/refactor",
              carryLocalChanges: true,
            },
          },
          { name: "BranchBot", role: "Worker" },
        ),
        launch(
          "loc-detach",
          "claude-base",
          "Detached worktree",
          "Runs in a detached worktree — no branch of its own.",
          {
            model: "claude-sonnet",
            worktree: { enabled: true, baseBranch: "main", mode: "detach" },
          },
          { name: "DetachBot", role: "Worker" },
        ),
        launch(
          "loc-attach",
          "claude-base",
          "Attach existing branch",
          "Runs in a worktree attached to an existing branch.",
          {
            model: "claude-sonnet",
            worktree: {
              enabled: true,
              baseBranch: "main",
              mode: "attach",
              branchName: "feat/multi-agents-collab",
            },
          },
          { name: "AttachBot", role: "Worker" },
        ),
        launch(
          "loc-nested",
          "codex-base",
          "Nested sub-package cwd",
          "Runs in a nested sub-package directory.",
          {
            model: "gpt-5.4",
            cwd: "/Users/me/projects/super-one/apps/desktop",
          },
          { name: "NestedBot", role: "Worker" },
        ),
      ],
    },
  }),
};

export const ManyAgents: Story = {
  name: "session_collab_request · Permission Prompt · many agents",
  ...permissionPromptStory("many agents", {
    value: {
      profiles,
      launches: Array.from({ length: 6 }, (_, index) =>
        launch(
          `launch-${index}`,
          index % 2 ? "codex-base" : "claude-base",
          permissionPayload.launches[index % 2].summary,
          `${permissionPayload.launches[index % 2].task} (#${index + 1})`,
          { model: index % 2 ? "gpt-5.4" : "claude-sonnet" },
          { name: `Agent ${index + 1}`, role: "Worker" },
        ),
      ),
    },
  }),
};

export const LinkExistingSession: Story = {
  name: "session_collab_request · Permission Prompt · link existing session",
  ...permissionPromptStory("link existing session", {
    value: {
      profiles,
      launches: [
        linkLaunch("link-review", {
          sessionId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          peerTitle: "API review session",
          summary:
            "Align with the existing review session on request/response types",
          task: [
            "## Opening",
            "Please confirm the request body shape for the new endpoint.",
            "",
            "- Field names",
            "- Optional vs required",
            "- Error envelope",
          ].join("\n"),
          peerHarnessId: "claude",
          peerHarnessName: "Claude",
          peerBrandKey: "claude",
        }),
      ],
    },
  }),
};

export const LinkWakeOnly: Story = {
  name: "session_collab_request · Permission Prompt · link wake only",
  ...permissionPromptStory("link wake only", {
    value: {
      profiles,
      launches: [
        linkLaunch("link-wake", {
          sessionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          peerTitle: "Implementer worktree",
          summary: "Open a mailbox so we can hand off the final PR checklist",
          peerProjectPath: "/Users/me/projects/other-app",
          peerHarnessId: "codex",
          peerHarnessName: "Codex",
          peerBrandKey: "codex",
        }),
      ],
    },
  }),
};

export const MixedSpawnAndLink: Story = {
  name: "session_collab_request · Permission Prompt · mixed spawn and link",
  ...permissionPromptStory("mixed spawn and link", {
    value: {
      profiles,
      launches: [
        launch(
          "spawn-impl",
          "claude-base",
          "Implement the API change",
          "Implement the API change and run focused tests.",
          {
            model: "claude-sonnet",
            effort: "high",
            permissionMode: "bypassPermissions",
            worktree: {
              enabled: true,
              baseBranch: "main",
              mode: "branch",
              branchName: "feat/api-change",
            },
          },
          { name: "Alice", role: "Implementer" },
        ),
        linkLaunch("link-peer", {
          sessionId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
          peerTitle: "Earlier design thread",
          summary: "Sync design decisions with the existing Grok session",
          task: "Please restate the agreed API contract before Alice lands the change.",
          peerHarnessId: "acp",
          peerHarnessName: "Grok",
          peerBrandKey: "acp-grok",
          peerAcpAgentId: "grok-build",
        }),
      ],
    },
  }),
};

export const MultipleLinks: Story = {
  name: "session_collab_request · Permission Prompt · multiple links",
  ...permissionPromptStory("multiple links", {
    value: {
      profiles,
      launches: [
        linkLaunch("link-a", {
          sessionId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
          peerTitle: "Typecheck cleanup",
          summary: "Ask the typecheck session for remaining errors",
          task: "List remaining `tsc` errors with file:line.",
          peerHarnessId: "codex",
          peerHarnessName: "Codex",
          peerBrandKey: "codex",
        }),
        linkLaunch("link-b", {
          sessionId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
          peerTitle: "Docs pass",
          summary: "Pull the docs outline from the writing session",
          peerHarnessId: "claude",
          peerHarnessName: "Claude",
          peerBrandKey: "claude",
        }),
      ],
    },
  }),
};

export const CollabStart: Story = {
  name: "session_collab_start",
  render: () => (
    <StoryShell>
      {block(
        "session_collab_start",
        { credential: CRED_A },
        { status: "streaming", elapsedSeconds: 1 },
      )}
      {block(
        "session_collab_start",
        { credential: CRED_A },
        { result: JSON.stringify(START_RESULT) },
      )}
    </StoryShell>
  ),
};

export const CollabSend: Story = {
  name: "session_collab_send",
  render: () => (
    <StoryShell>
      {block(
        "session_collab_send",
        { credential: CRED_A, content: "Please reply with status." },
        { status: "streaming" },
      )}
      {block(
        "session_collab_send",
        {
          credential: CRED_A,
          content: "The review is complete; see the findings below.",
        },
        {
          result: JSON.stringify({
            status: "sent",
            messageId: "msg-1",
            sequence: 1,
          }),
        },
      )}
    </StoryShell>
  ),
};

export const CollabRetrieve: Story = {
  name: "session_collab_retrieve",
  render: () => (
    <StoryShell>
      {block(
        "session_collab_retrieve",
        { credentials: [CRED_A] },
        { status: "streaming" },
      )}
      {block(
        "session_collab_retrieve",
        { credentials: [CRED_A] },
        {
          result: JSON.stringify({
            status: "messages",
            peers: LAUNCHES_ONE.launches,
            messages: [],
          }),
        },
      )}
    </StoryShell>
  ),
};
