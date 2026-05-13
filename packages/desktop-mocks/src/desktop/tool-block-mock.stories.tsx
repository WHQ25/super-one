import type { Meta, StoryObj } from "@storybook/react-vite"
import { ToolBlockMock } from "./tool-block-mock"

const meta: Meta<typeof ToolBlockMock> = {
  title: "Desktop Mocks/ToolBlockMock",
  component: ToolBlockMock,
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

type Story = StoryObj<typeof ToolBlockMock>

export const BashCollapsed: Story = {
  args: {
    spec: { variant: "bash", command: "bun test", output: "21 passed | 0 failed" },
  },
}

export const BashExpanded: Story = {
  args: {
    expanded: true,
    spec: {
      variant: "bash",
      command: "bun test apps/desktop/src/main",
      output:
        "✓ session.test.ts (12 passed)\n✓ chat-store.test.ts (8 passed)\n✗ permission-flow.test.ts (1 failed)\n  └ expected pendingPermissions to be empty after deny()",
    },
  },
}

export const BashRunning: Story = {
  args: {
    expanded: true,
    isStreaming: true,
    spec: { variant: "bash", command: "bun run build:mac" },
  },
}

export const EditDiff: Story = {
  args: {
    expanded: true,
    spec: {
      variant: "edit",
      filePath: "src/main/session/session.ts",
      startLine: 312,
      oldText:
        "this.pendingPermissions = this.pendingPermissions.filter((p) => p.id !== id)\nthis.emit('permission_resolved', id)",
      newText:
        "this.pendingPermissions = this.pendingPermissions.map((p) => (\n  p.id === id ? { ...p, status: 'denying' } : p\n))\nthis.emit('permission_resolved', id)",
    },
  },
}

export const Write: Story = {
  args: {
    expanded: true,
    spec: {
      variant: "write",
      filePath: "src/test/permission-flow.test.ts",
      content:
        "import { describe, it, expect } from 'vitest'\n\ndescribe('permission flow', () => {\n  it('clears pendingPermissions after deny acknowledged', async () => {\n    // ...\n  })\n})",
    },
  },
}

export const ReadWithPreview: Story = {
  args: {
    expanded: true,
    spec: {
      variant: "read",
      filePath: "apps/desktop/src/main/session/session.ts",
      lineRange: "300-320",
      preview:
        "export class Session extends EventEmitter {\n  private pendingPermissions: PermissionRequest[] = []\n  // ...\n}",
    },
  },
}

export const Denied: Story = {
  args: {
    expanded: false,
    spec: { variant: "bash", command: "rm -rf node_modules", denied: true },
  },
}

export const Grep: Story = {
  args: {
    expanded: true,
    spec: {
      variant: "grep",
      pattern: "PermissionPrompt",
      path: "apps/desktop/src/renderer/src/components/chat",
      matches:
        "PermissionPrompt.tsx:104  export function PermissionPrompt() {\nPermissionPrompt.integration.test.tsx:18  describe('PermissionPrompt', ...)",
    },
  },
}

export const Glob: Story = {
  args: {
    expanded: true,
    spec: {
      variant: "glob",
      pattern: "**/*.stories.tsx",
      path: "packages",
      matches:
        "packages/ui/src/components/ui/button.stories.tsx\npackages/desktop-mocks/src/desktop/chat-mock.stories.tsx",
    },
  },
}

export const WebSearch: Story = {
  args: {
    spec: { variant: "webSearch", query: "remotion play composition props" },
  },
}

export const WebFetch: Story = {
  args: {
    expanded: true,
    spec: {
      variant: "webFetch",
      url: "https://www.remotion.dev/docs/player",
      preview:
        "The Player lets you embed a composition into a regular React app… frame, fps, durationInFrames passed through.",
    },
  },
}

export const Task: Story = {
  args: {
    spec: {
      variant: "task",
      subagent: "code-reviewer",
      description: "Audit cross-package types for the new mocks",
    },
  },
}

export const Mcp: Story = {
  args: {
    expanded: true,
    spec: {
      variant: "mcp",
      serverName: "context7",
      toolName: "query-docs",
      summary: "react · useEffect",
      result: '{"library":"react","topic":"useEffect","matches":3}',
    },
  },
}

export const Skill: Story = {
  args: {
    spec: { variant: "skill", skill: "generate-test-cases" },
  },
}

export const NotebookEdit: Story = {
  args: {
    expanded: true,
    spec: {
      variant: "notebookEdit",
      notebookPath: "notebooks/analysis.ipynb",
      oldSource: "df.head()",
      newSource: "df.head(20)\ndf.describe()",
    },
  },
}

export const FileChange: Story = {
  args: {
    expanded: true,
    spec: {
      variant: "fileChange",
      filePath: "scripts/promote.yml",
      kind: "edit",
      diff: "- name: build\n+ name: build-mac\n  uses: ./.github/actions/build",
    },
  },
}

export const AskUserQuestionDone: Story = {
  args: {
    expanded: true,
    spec: {
      variant: "askUserQuestion",
      summary: "2 questions",
      qa: [
        { question: "Approach", answer: "Frame-driven dual-mode" },
        { question: "Coverage", answer: "ChatMock, ToolBlockMock, FileTreeMock" },
      ],
    },
  },
}

export const BannerEnterPlanMode: Story = {
  args: { spec: { variant: "banner", kind: "enterPlanMode" } },
}

export const BannerPlanApproved: Story = {
  args: { spec: { variant: "banner", kind: "planApproved" } },
}

export const BannerPlanRejected: Story = {
  args: {
    spec: {
      variant: "banner",
      kind: "planRejected",
      feedback: "Need to align auth boundary before refactoring sidebar.",
    },
  },
}

export const ErroredGeneric: Story = {
  args: {
    expanded: true,
    spec: {
      variant: "generic",
      tool: "FileChange",
      summary: "src/missing.ts",
      bodyText: "File not found at expected path. Did you mean src/missing.tsx?",
      errored: true,
    },
  },
}
