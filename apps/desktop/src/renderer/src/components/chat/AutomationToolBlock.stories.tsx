import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { encode as toonEncode } from "@toon-format/toon";
import type { AutomationConfirmPayload } from "@superone/shared/agent-types";
import {
  AutomationConfirmPrompt,
  type AutomationConfirmResult,
} from "./AutomationConfirmPrompt";
import {
  AutomationToolBlock,
  type AutomationToolName,
} from "./AutomationToolBlock";

/**
 * SuperOne automation tool UI — design preview (Storybook only).
 *
 * Label grammar matches collab / archive (`chat.toolBlock.automation`):
 * - Streaming: sentence case + …  e.g. "Listing automations…", "Creating automation…"
 * - Done primary: Title Case (EN) e.g. "Automations Listed", "Automation Created"
 * - Counts / empty in muted summary: "2 automations", "No automations"
 *
 * Wired into ToolBlock; stories remain the design/regression gallery.
 */

function StoryShell({
  children,
  width = 640,
}: {
  children: ReactNode;
  width?: number;
}) {
  return (
    <div className="@container space-y-4" style={{ maxWidth: width }}>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
  );
}

function AutomationPermissionPrompt({
  payload,
}: {
  payload: AutomationConfirmPayload;
}) {
  const [result, setResult] = useState<string | null>(null);
  return (
    <div>
      <AutomationConfirmPrompt
        payload={payload}
        onConfirm={(value?: AutomationConfirmResult) =>
          setResult(value ? `allow: ${JSON.stringify(value)}` : "allow")
        }
        onReject={(feedback) =>
          setResult(feedback ? `deny: ${feedback}` : "deny")
        }
      />
      {result ? (
        <pre className="mx-3 mt-1 rounded bg-muted/40 p-2 text-[10px] break-all">
          {result}
        </pre>
      ) : null}
    </div>
  );
}

function block(
  tool: AutomationToolName,
  params: Record<string, unknown>,
  opts: {
    status?: "streaming" | "complete";
    result?: string;
    isError?: boolean;
    isDenied?: boolean;
    allowExpand?: boolean;
  } = {},
) {
  return (
    <AutomationToolBlock
      toolName={tool}
      params={params}
      result={opts.result}
      isStreaming={opts.status === "streaming"}
      isError={opts.isError}
      isDenied={opts.isDenied}
      allowExpand={opts.allowExpand}
    />
  );
}

// --- Fixtures (shape aligned with automation-tools handlers) ---

const LIST_ROWS = [
  {
    id: "auto-aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa",
    name: "Daily Review",
    enabled: true,
    agent: "claude",
    schedule: "daily 09:00",
    lastRunStatus: "completed",
    lastRunAt: "2026-08-10T09:00:12.000Z",
    nextRunAt: "2026-08-11T09:00:00.000Z",
    promptPreview: "Review recent commits and summarize blockers for standup",
  },
  {
    id: "auto-bbbbbbbb-2222-4000-8000-bbbbbbbbbbbb",
    name: "Nightly test suite",
    enabled: false,
    agent: "codex",
    schedule: "cron 0 2 * * *",
    lastRunStatus: "error",
    lastRunAt: "2026-08-09T02:00:05.000Z",
    nextRunAt: null,
    promptPreview: "Run the full unit test suite and report failures",
  },
  {
    id: "auto-cccccccc-3333-4000-8000-cccccccccccc",
    name: "One-shot deploy check",
    enabled: true,
    agent: "claude",
    schedule: "once @ 2026-08-12 15:30",
    lastRunStatus: null,
    lastRunAt: null,
    nextRunAt: "2026-08-12T15:30:00.000Z",
    promptPreview: "Verify staging health after the deploy window",
  },
];

const LIST_RESULT_TOON = toonEncode({
  status: "ok",
  count: LIST_ROWS.length,
  total: LIST_ROWS.length,
  offset: 0,
  limit: 50,
  hasMore: false,
  automations: LIST_ROWS,
});

const LIST_EMPTY_TOON = toonEncode({
  status: "ok",
  count: 0,
  total: 0,
  offset: 0,
  limit: 50,
  hasMore: false,
  automations: [],
});

const DETAIL_RESULT = JSON.stringify({
  status: "ok",
  automation: {
    id: LIST_ROWS[0]!.id,
    name: "Daily Review",
    prompt:
      "Review recent commits and summarize blockers for standup.\nFocus on open PRs and failing CI.",
    enabled: true,
    agentConfig: {
      type: "claude",
      permissionMode: "bypassPermissions",
      sandboxMode: "off",
      model: "claude-sonnet-4",
    },
    schedule: {
      type: "recurring",
      cron: "0 9 * * *",
      preset: "daily",
      timeOfDay: "09:00",
    },
    scheduleSummary: "daily 09:00",
    lastRunAt: "2026-08-10T09:00:12.000Z",
    lastRunStatus: "completed",
    lastRunSessionId: "sess-auto-run-1",
    nextRunAt: "2026-08-11T09:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-08-10T09:00:12.000Z",
  },
});

const CREATE_RESULT = JSON.stringify({
  status: "ok",
  action: "create",
  automation: {
    id: "auto-new-4444-4000-8000-dddddddddddd",
    name: "Weekly changelog",
    prompt: "Draft a weekly changelog from merged PRs",
    enabled: true,
    agentConfig: {
      type: "claude",
      permissionMode: "bypassPermissions",
      sandboxMode: "off",
    },
    schedule: {
      type: "recurring",
      cron: "0 10 * * 1",
      preset: "weekly",
      timeOfDay: "10:00",
      dayOfWeek: [1],
    },
    scheduleSummary: "weekly d=1 10:00",
    lastRunAt: null,
    lastRunStatus: null,
    lastRunSessionId: null,
    nextRunAt: "2026-08-18T10:00:00.000Z",
    createdAt: "2026-08-11T08:00:00.000Z",
    updatedAt: "2026-08-11T08:00:00.000Z",
  },
});

const TOGGLE_OFF_RESULT = JSON.stringify({
  status: "ok",
  action: "update",
  automation: {
    ...JSON.parse(CREATE_RESULT).automation,
    enabled: false,
    name: "Daily Review",
    scheduleSummary: "daily 09:00",
  },
});

const DELETE_OK = JSON.stringify({
  status: "ok",
  deleted: [
    { id: LIST_ROWS[0]!.id, name: "Daily Review" },
    { id: LIST_ROWS[1]!.id, name: "Nightly test suite" },
  ],
});

const DELETE_PARTIAL = JSON.stringify({
  status: "partial",
  deleted: [{ id: LIST_ROWS[0]!.id, name: "Daily Review" }],
  failed: [
    {
      id: LIST_ROWS[1]!.id,
      name: "Nightly test suite",
      error: "not found at delete time",
    },
  ],
});

const DELETE_NOT_FOUND = JSON.stringify({
  status: "not_found",
  deleted: [],
  notFound: ["missing-id"],
  wrongProject: [],
  message:
    "No matching automations in the current project to delete. Call automation_list to refresh ids.",
});

const ERROR_RESULT = JSON.stringify({
  status: "error",
  message:
    'Invalid or unusable cron "not a cron". Use a standard 5-field expression (e.g. "0 9 * * *").',
});

const CREATE_CONFIRM: AutomationConfirmPayload = {
  operation: "create",
  items: [
    {
      name: "Daily Review",
      scheduleSummary: "每个工作日上午 9 点",
      agentType: "claude",
      agent: {
        type: "claude",
        permissionMode: "bypassPermissions",
        sandboxMode: "off",
        model: "claude-sonnet-4",
        effort: "high",
      },
      enabled: true,
      promptPreview: "Review recent commits and summarize blockers for standup",
      prompt: [
        "## Daily standup prep",
        "",
        "1. Review recent commits since yesterday",
        "2. Summarize **blockers** and open PRs",
        "3. Suggest a short agenda:",
        "",
        "```md",
        "- Wins",
        "- Risks",
        "- Asks",
        "```",
      ].join("\n"),
    },
  ],
};

const CREATE_CODEX_CONFIRM: AutomationConfirmPayload = {
  operation: "create",
  items: [
    {
      name: "Codex nightly",
      scheduleSummary: "Every night at 2:00 AM",
      agent: {
        type: "codex",
        permissionMode: "bypassPermissions",
        permissionPreset: "full-access",
        model: "gpt-5.4",
        effort: "high",
      },
      enabled: true,
      promptPreview: "Run the flaky suite and open a report issue",
      prompt:
        "Run the flaky suite overnight and open a report issue if failures regress.",
    },
  ],
};

const UPDATE_TOGGLE_CONFIRM: AutomationConfirmPayload = {
  operation: "update",
  items: [
    {
      id: "auto-aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa",
      name: "Daily Review",
      scheduleSummary: "每个工作日上午 9 点",
      agent: {
        type: "claude",
        permissionMode: "bypassPermissions",
        sandboxMode: "off",
      },
      enabled: false,
    },
  ],
  changes: [{ field: "enabled", from: "on", to: "off" }],
};

const UPDATE_PERMISSION_CONFIRM: AutomationConfirmPayload = {
  operation: "update",
  items: [
    {
      id: "auto-aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa",
      name: "Daily Review",
      scheduleSummary: "每个工作日上午 9 点",
      agent: {
        type: "claude",
        permissionMode: "bypassPermissions",
        sandboxMode: "off",
        model: "claude-sonnet-4",
        effort: "high",
      },
      enabled: true,
      promptPreview: "Review recent commits and summarize blockers for standup",
      prompt: "Review recent commits and summarize blockers for standup",
    },
  ],
  changes: [
    {
      field: "agent",
      to: "claude · bypassPermissions · sandbox off",
      agentTo: {
        type: "claude",
        permissionMode: "bypassPermissions",
        sandboxMode: "off",
        model: "claude-sonnet-4",
      },
    },
  ],
};

const UPDATE_MULTI_CONFIRM: AutomationConfirmPayload = {
  operation: "update",
  items: [
    {
      id: "auto-aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa",
      name: "Daily Review (renamed)",
      scheduleSummary: "每天上午 10 点",
      agent: {
        type: "codex",
        permissionMode: "bypassPermissions",
        permissionPreset: "full-access",
        model: "gpt-5.6-sol",
        effort: "xhigh",
      },
      enabled: true,
      promptPreview: "Draft a weekly changelog from merged PRs",
      prompt: [
        "Draft a weekly changelog from merged PRs.",
        "",
        "- Group by area",
        "- Call out breaking changes",
      ].join("\n"),
    },
  ],
  changes: [
    { field: "name", to: "Daily Review (renamed)" },
    { field: "schedule", to: "每天上午 10 点" },
    {
      field: "agent",
      agentTo: {
        type: "codex",
        permissionMode: "bypassPermissions",
        permissionPreset: "full-access",
        model: "gpt-5.6-sol",
        effort: "xhigh",
      },
    },
    { field: "prompt", to: "Draft a weekly changelog from merged PRs" },
  ],
};

const DELETE_CONFIRM: AutomationConfirmPayload = {
  operation: "delete",
  items: [
    {
      id: "auto-aaaaaaaa-1111-4000-8000-aaaaaaaaaaaa",
      name: "Daily Review",
      scheduleSummary: "每个工作日上午 9 点",
      enabled: true,
    },
    {
      id: "auto-bbbbbbbb-2222-4000-8000-bbbbbbbbbbbb",
      name: "Nightly test suite",
      scheduleSummary: "Every night at 2:00 AM",
      enabled: false,
    },
  ],
};

const meta: Meta = {
  // Same tree style as SessionArchive/ToolUI so it sits next to archive/collab galleries.
  title: "Tool UI/SuperOne MCP/Automation",
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj;

export const Gallery: Story = {
  name: "Gallery",
  render: () => (
    <StoryShell>
      <Note>
        Automation MCP tools always use the CalendarClock brand glyph. User
        reject / cancel uses Ban + denied (red) row styling; hard errors use
        TriangleAlert + warning tone. HITL confirm cards are listed below the
        tool rows as <strong>Permission Prompt</strong> stories.
      </Note>

      <Section title="automation_list">
        {block("automation_list", {}, { status: "streaming" })}
        {block("automation_list", { query: "daily" }, { status: "streaming" })}
        {block("automation_list", {}, { result: LIST_RESULT_TOON })}
        {block("automation_list", {}, { result: LIST_EMPTY_TOON })}
        {block(
          "automation_list",
          { id: LIST_ROWS[0]!.id },
          { status: "streaming" },
        )}
        {block(
          "automation_list",
          { id: LIST_ROWS[0]!.id },
          { result: DETAIL_RESULT },
        )}
        {block(
          "automation_list",
          {},
          {
            isError: true,
            result: JSON.stringify({
              status: "error",
              message: "No project path for the current session.",
            }),
          },
        )}
        {block(
          "automation_list",
          {},
          { isDenied: true, result: "[denied] permission" },
        )}
      </Section>

      <Section title="automation_apply">
        {block(
          "automation_apply",
          {
            action: "create",
            name: "Weekly changelog",
            prompt: "Draft a weekly changelog",
            schedule: { type: "recurring", cron: "0 10 * * 1" },
          },
          { status: "streaming" },
        )}
        {block(
          "automation_apply",
          {
            action: "create",
            name: "Weekly changelog",
            schedule: { type: "recurring", cron: "0 10 * * 1" },
          },
          { result: CREATE_RESULT },
        )}
        {block(
          "automation_apply",
          {
            action: "create",
            name: "Weekly changelog",
          },
          {
            result: JSON.stringify({
              status: "rejected",
              message: "User did not approve automation create.",
            }),
          },
        )}
        {block(
          "automation_apply",
          {
            action: "update",
            id: LIST_ROWS[0]!.id,
            name: "Daily Review (renamed)",
          },
          {
            result: JSON.stringify({
              status: "rejected",
              message: "User did not approve automation update.",
            }),
          },
        )}
        {block(
          "automation_apply",
          { action: "update", id: LIST_ROWS[0]!.id, enabled: false },
          {
            result: JSON.stringify({
              status: "rejected",
              message: "User did not approve automation update.",
            }),
          },
        )}
        {block(
          "automation_apply",
          { action: "update", id: LIST_ROWS[0]!.id, enabled: false },
          { status: "streaming" },
        )}
        {block(
          "automation_apply",
          { action: "update", id: LIST_ROWS[0]!.id, enabled: false },
          { result: TOGGLE_OFF_RESULT },
        )}
        {block(
          "automation_apply",
          {
            action: "update",
            id: LIST_ROWS[0]!.id,
            name: "Daily Review (renamed)",
          },
          {
            result: JSON.stringify({
              status: "ok",
              action: "update",
              automation: {
                ...JSON.parse(CREATE_RESULT).automation,
                name: "Daily Review (renamed)",
                scheduleSummary: "daily 09:00",
              },
            }),
          },
        )}
        {block(
          "automation_apply",
          {
            action: "create",
            name: "Broken",
            schedule: { type: "recurring", cron: "not a cron" },
          },
          { isError: true, result: ERROR_RESULT },
        )}
      </Section>

      <Section title="automation_delete">
        {block(
          "automation_delete",
          { ids: [LIST_ROWS[0]!.id, LIST_ROWS[1]!.id] },
          { status: "streaming" },
        )}
        {block(
          "automation_delete",
          { ids: [LIST_ROWS[0]!.id, LIST_ROWS[1]!.id] },
          { result: DELETE_OK },
        )}
        {block(
          "automation_delete",
          { ids: [LIST_ROWS[0]!.id, LIST_ROWS[1]!.id] },
          { result: DELETE_PARTIAL },
        )}
        {block(
          "automation_delete",
          { ids: ["missing-id"] },
          { result: DELETE_NOT_FOUND },
        )}
        {block(
          "automation_delete",
          { ids: [LIST_ROWS[0]!.id] },
          {
            result: JSON.stringify({
              status: "cancelled",
              message: "Automation delete cancelled",
            }),
          },
        )}
        {block(
          "automation_delete",
          { ids: [LIST_ROWS[0]!.id] },
          {
            result: JSON.stringify({
              status: "rejected",
              message: "User did not approve automation deletion.",
            }),
          },
        )}
        {block(
          "automation_delete",
          { ids: [LIST_ROWS[0]!.id] },
          {
            isError: true,
            result: JSON.stringify({
              status: "error",
              message:
                "Cannot open delete confirmation: current session host is unavailable.",
            }),
          },
        )}
      </Section>

      <Section title="allowExpand=false (nested subagent)">
        {block(
          "automation_list",
          {},
          { result: LIST_RESULT_TOON, allowExpand: false },
        )}
        {block(
          "automation_apply",
          { action: "create", name: "Weekly changelog" },
          { result: CREATE_RESULT, allowExpand: false },
        )}
        {block(
          "automation_delete",
          { ids: [LIST_ROWS[0]!.id] },
          { result: DELETE_OK, allowExpand: false },
        )}
      </Section>
    </StoryShell>
  ),
};

export const AutomationList: Story = {
  name: "automation_list",
  render: () => (
    <StoryShell>
      <Section title="automation_list">
        {block("automation_list", {}, { status: "streaming" })}
        {block("automation_list", {}, { result: LIST_RESULT_TOON })}
        {block(
          "automation_list",
          { id: LIST_ROWS[0]!.id },
          { result: DETAIL_RESULT },
        )}
        {block(
          "automation_list",
          {},
          {
            isError: true,
            result: JSON.stringify({
              status: "error",
              message: "No project path for the current session.",
            }),
          },
        )}
      </Section>
    </StoryShell>
  ),
};

export const AutomationApply: Story = {
  name: "automation_apply",
  render: () => (
    <StoryShell>
      <Section title="automation_apply">
        {block(
          "automation_apply",
          {
            action: "create",
            name: "Weekly changelog",
            schedule: { type: "recurring", cron: "0 10 * * 1" },
          },
          { status: "streaming" },
        )}
        {block(
          "automation_apply",
          { action: "create", name: "Weekly changelog" },
          { result: CREATE_RESULT },
        )}
        {block(
          "automation_apply",
          { action: "update", id: LIST_ROWS[0]!.id, enabled: false },
          { result: TOGGLE_OFF_RESULT },
        )}
        {block(
          "automation_apply",
          {
            action: "create",
            name: "Broken",
            schedule: { type: "recurring", cron: "not a cron" },
          },
          { isError: true, result: ERROR_RESULT },
        )}
      </Section>
    </StoryShell>
  ),
};

export const PermissionPromptGallery: Story = {
  name: "automation_apply · Permission Prompt · gallery",
  render: () => (
    <StoryShell width={580}>
      <Note>
        Create and update show the resulting snapshot plus the collaboration
        toolbar for model, effort, permission, and sandbox.
      </Note>
      <Section title="create · Claude">
        <AutomationPermissionPrompt payload={CREATE_CONFIRM} />
      </Section>
      <Section title="create · Codex">
        <AutomationPermissionPrompt payload={CREATE_CODEX_CONFIRM} />
      </Section>
      <Section title="update · toggle">
        <AutomationPermissionPrompt payload={UPDATE_TOGGLE_CONFIRM} />
      </Section>
      <Section title="update · agent">
        <AutomationPermissionPrompt payload={UPDATE_PERMISSION_CONFIRM} />
      </Section>
      <Section title="update · multiple fields">
        <AutomationPermissionPrompt payload={UPDATE_MULTI_CONFIRM} />
      </Section>
    </StoryShell>
  ),
};

export const Create: Story = {
  name: "automation_apply · Permission Prompt · create",
  render: () => <AutomationPermissionPrompt payload={CREATE_CONFIRM} />,
};

export const CreateCodex: Story = {
  name: "automation_apply · Permission Prompt · create · Codex",
  render: () => <AutomationPermissionPrompt payload={CREATE_CODEX_CONFIRM} />,
};

export const UpdatePermission: Story = {
  name: "automation_apply · Permission Prompt · update permission",
  render: () => (
    <AutomationPermissionPrompt payload={UPDATE_PERMISSION_CONFIRM} />
  ),
};

export const UpdateToggle: Story = {
  name: "automation_apply · Permission Prompt · update toggle off",
  render: () => <AutomationPermissionPrompt payload={UPDATE_TOGGLE_CONFIRM} />,
};

export const AutomationDelete: Story = {
  name: "automation_delete",
  render: () => (
    <StoryShell>
      <Section title="automation_delete">
        {block(
          "automation_delete",
          { ids: [LIST_ROWS[0]!.id, LIST_ROWS[1]!.id] },
          { status: "streaming" },
        )}
        {block(
          "automation_delete",
          { ids: [LIST_ROWS[0]!.id, LIST_ROWS[1]!.id] },
          { result: DELETE_OK },
        )}
        {block(
          "automation_delete",
          { ids: [LIST_ROWS[0]!.id] },
          {
            result: JSON.stringify({
              status: "cancelled",
              message: "Automation delete cancelled",
            }),
          },
        )}
        {block(
          "automation_delete",
          { ids: [LIST_ROWS[0]!.id] },
          {
            isError: true,
            result: JSON.stringify({
              status: "error",
              message: "Confirmation unavailable",
            }),
          },
        )}
      </Section>
    </StoryShell>
  ),
};

export const Delete: Story = {
  name: "automation_delete · Permission Prompt · delete",
  render: () => <AutomationPermissionPrompt payload={DELETE_CONFIRM} />,
};
