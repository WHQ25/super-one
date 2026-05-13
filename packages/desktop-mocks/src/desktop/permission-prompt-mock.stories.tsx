import type { Meta, StoryObj } from "@storybook/react-vite"
import { PermissionPromptMock } from "./permission-prompt-mock"

const meta: Meta<typeof PermissionPromptMock> = {
  title: "Desktop Mocks/PermissionPromptMock",
  component: PermissionPromptMock,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ width: 720 }}>
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof PermissionPromptMock>

export const Bash: Story = {
  args: {
    spec: { variant: "bash", command: "bun test" },
    description: "run the test suite once",
    focusedAction: "allow",
  },
}

export const BashDangerous: Story = {
  args: {
    spec: { variant: "bash", command: "rm -rf node_modules" },
    description: "purge node_modules before reinstall",
    decisionReason: "destructive command — review carefully",
    focusedAction: "deny",
  },
}

export const Edit: Story = {
  args: {
    spec: {
      variant: "edit",
      filePath: "src/main/session/session.ts",
      startLine: 312,
      oldText:
        "this.pendingPermissions = this.pendingPermissions.filter((p) => p.id !== id)",
      newText:
        "this.pendingPermissions = this.pendingPermissions.map((p) => (\n  p.id === id ? { ...p, status: 'denying' } : p\n))",
    },
    focusedAction: "allow",
  },
}

export const Write: Story = {
  args: {
    spec: {
      variant: "write",
      filePath: "src/test/permission-flow.test.ts",
      content:
        "import { describe, it, expect } from 'vitest'\n\ndescribe('permission flow', () => {\n  it('keeps pendingPermissions until SDK acks', async () => {})\n})",
    },
    focusedAction: "allow",
  },
}

export const CodexDecision: Story = {
  args: {
    spec: { variant: "bash", command: "bun run dev:web" },
    mode: "codex_decision",
    description: "start the marketing site dev server",
    focusedAction: "allow",
  },
}

export const BashWithSandboxOverride: Story = {
  args: {
    spec: { variant: "bash", command: "bun test:full" },
    description: "needs to bind 0.0.0.0:5353 for mdns tests",
    dangerouslyDisableSandbox: true,
    focusedAction: "allow",
  },
}

export const WithSuggestions: Story = {
  args: {
    spec: { variant: "bash", command: "bun install" },
    suggestions: [
      { label: "Allow Bash(bun install) for this session", selected: true },
      { label: "Allow Bash(bun *) for this project" },
      { label: "Switch to acceptEdits" },
    ],
    focusedAction: "allow",
  },
}

export const ReadFile: Story = {
  args: {
    spec: {
      variant: "read",
      filePath: "~/.ssh/config",
      lineRange: "L1-L40",
    },
    decisionReason: "Sensitive path — review before allowing",
    focusedAction: "deny",
  },
}

export const McpTool: Story = {
  args: {
    spec: {
      variant: "mcp",
      serverName: "stripe",
      toolName: "fetch_customer",
      summary: "customer_id: cus_LpA42q",
    },
    focusedAction: "allow",
  },
}

export const WebFetchPermission: Story = {
  args: {
    spec: {
      variant: "webFetch",
      url: "https://api.openai.com/v1/embeddings",
    },
    decisionReason: "Outbound request from sandboxed turn",
    focusedAction: "allow",
  },
}

export const SandboxNetworkVariant: Story = {
  args: {
    mode: "sandbox_network",
    sandboxNetwork: { host: "api.openai.com" },
    decisionReason: "Codex CLI wants outbound network access from a sandboxed turn.",
    focusedAction: "allow",
  },
}

export const Elicitation: Story = {
  args: {
    mode: "elicitation",
    elicitation: {
      serverName: "stripe",
      message: "Allow Stripe MCP to fetch customer details?",
      subtitle: "The tool will read customer_id you provide and call /v1/customers.",
      riskLevel: "medium",
      fields: [
        {
          name: "customer_id",
          label: "Customer ID",
          type: "string",
          value: "cus_LpA42q",
        },
        { name: "include_invoices", label: "Include invoices", type: "boolean", value: true },
      ],
    },
    focusedAction: "allow",
  },
}
