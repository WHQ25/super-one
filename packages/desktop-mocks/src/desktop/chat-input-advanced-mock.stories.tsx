import type { Meta, StoryObj } from "@storybook/react-vite"
import { ChatInputAdvancedMock } from "./chat-input-advanced-mock"

const meta: Meta<typeof ChatInputAdvancedMock> = {
  title: "Desktop Mocks/ChatInputAdvanced",
  component: ChatInputAdvancedMock,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ width: 880 }} className="rounded-xl border border-border bg-card p-3">
        <Story />
      </div>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof ChatInputAdvancedMock>

export const Empty: Story = {}

export const Typing: Story = {
  args: {
    value: "Help me refactor the sidebar so the project rows collapse independently",
  },
}

export const PromptSuggestion: Story = {
  args: {
    promptSuggestion: "Continue the migration: switch the remaining call sites to the new useSession() hook.",
  },
}

export const SlashPopup: Story = {
  args: {
    value: "/rev",
    slashPopup: {
      query: "rev",
      activeIndex: 0,
      commands: [
        {
          name: "review",
          description: "Run a code review against the current diff",
          argumentHint: "<scope?>",
          matchIndices: [0, 1, 2],
        },
        {
          name: "revert",
          description: "Reset the last edit so the diff is dropped",
          matchIndices: [0, 1, 2],
        },
        {
          name: "rewrite",
          description: "Have the agent rewrite a function from spec",
          isSkill: true,
          matchIndices: [0, 1],
        },
      ],
    },
  },
}

export const MentionPopupFiles: Story = {
  args: {
    value: "@chat",
    mentionPopup: {
      query: "chat",
      breadcrumbs: ["super-one", "apps", "desktop"],
      activeIndex: 1,
      items: [
        { kind: "file", name: "ChatInput.tsx", subtitle: "renderer/chat", matchIndices: [0, 1, 2, 3] },
        { kind: "file", name: "ChatMessage.tsx", subtitle: "renderer/chat", matchIndices: [0, 1, 2, 3] },
        { kind: "file", name: "ChatPanel.tsx", subtitle: "renderer/chat", matchIndices: [0, 1, 2, 3] },
        { kind: "directory", name: "chat/", subtitle: "renderer/components", matchIndices: [0, 1, 2, 3] },
        { kind: "agent", name: "code-reviewer", subtitle: "sonnet", matchIndices: [] },
      ],
    },
  },
}

export const MentionChipInline: Story = {
  args: {
    mentions: [{ kind: "file", displayName: "ChatInput.tsx" }],
    value: " — pull out the chip rendering into its own component, keep TipTap atoms intact.",
  },
}

export const MultipleMentionsAndAgent: Story = {
  args: {
    mentions: [
      { kind: "agent", displayName: "code-reviewer" },
      { kind: "directory", displayName: "packages/desktop-mocks/" },
      { kind: "file", displayName: "ChatInput.tsx" },
    ],
    value: " — review the new chip layout end-to-end.",
  },
}

export const PasteChip: Story = {
  args: {
    pasteChips: [
      {
        preview: "import { useEditor } from '@tiptap/react' const editor = useEditor({ extensio…",
        lineCount: 142,
      },
    ],
    value: "Fix the regression in here:",
  },
}

export const PasteChipsMultiple: Story = {
  args: {
    pasteChips: [
      {
        preview: "## Bug report  Steps to reproduce: 1) open the worktree picker  2) pick branch…",
        lineCount: 48,
      },
      {
        preview: "{ \"error\": \"SessionLockedError\", \"deviceId\": \"phone-2\", \"reason\": \"remote owns…\" }",
        lineCount: 23,
        selected: true,
      },
    ],
  },
}

export const Dragging: Story = {
  args: {
    isDragging: true,
    value: "Working on this fix",
  },
}

export const ImageAttachments: Story = {
  args: {
    attachments: [
      { type: "image", name: "screenshot-1.png", thumbnail: { kind: "screenshot", hueA: 200, hueB: 260 } },
      { type: "image", name: "design.png", thumbnail: { kind: "screenshot", hueA: 30, hueB: 320 } },
      { type: "image", name: "wallpaper.jpg", thumbnail: { kind: "photo", hueA: 200, hueB: 260 } },
      { type: "image", name: "code.png", thumbnail: { kind: "code", accent: 200 } },
      { type: "image", name: "flow.png", thumbnail: { kind: "diagram", accent: 200 } },
    ],
    value: "What's wrong with this screen?",
  },
}

export const PdfAttachments: Story = {
  args: {
    attachments: [
      { type: "pdf", name: "spec.pdf", pages: 12 },
      { type: "pdf", name: "design-doc.pdf", pages: 8 },
      { type: "image", name: "preview.png", thumbnail: { kind: "screenshot", hueA: 200, hueB: 280 } },
    ],
    value: "Summarize this design doc and call out anything you'd push back on.",
  },
}

export const MiniAppContextSuggest: Story = {
  args: {
    miniAppContexts: [
      {
        appId: "calendar",
        appName: "Calendar",
        color: "#0ea5e9",
        summary: "3 meetings today",
        mode: "suggest",
        checked: false,
      },
    ],
  },
}

export const MiniAppContextActive: Story = {
  args: {
    miniAppContexts: [
      {
        appId: "calendar",
        appName: "Calendar",
        color: "#0ea5e9",
        summary: "3 meetings today",
        mode: "always",
      },
      {
        appId: "linear",
        appName: "Linear",
        color: "#8b5cf6",
        summary: "5 issues in this sprint",
        mode: "always",
      },
    ],
    value: "Plan my afternoon around the calendar and pending Linear issues.",
  },
}

export const UserSelection: Story = {
  args: {
    userSelections: [
      {
        filePath: "apps/desktop/src/renderer/src/components/chat/ChatInput.tsx",
        rangeText: "L412-L468",
      },
    ],
    value: "Why does this branch reset the slash dismissal?",
  },
}

export const Everything: Story = {
  args: {
    value: "ship the rewrite as-is.",
    mentions: [
      { kind: "agent", displayName: "code-reviewer" },
      { kind: "file", displayName: "ChatInput.tsx" },
    ],
    pasteChips: [
      {
        preview: "diff --git a/apps/desktop/src/renderer/src/components/chat/ChatInput.tsx",
        lineCount: 96,
      },
    ],
    attachments: [
      { type: "pdf", name: "spec.pdf", pages: 12 },
      { type: "image", name: "screenshot.png", thumbnail: { kind: "screenshot", hueA: 200, hueB: 260 } },
    ],
    miniAppContexts: [
      { appId: "linear", appName: "Linear", color: "#8b5cf6", summary: "SUP-417", mode: "always" },
    ],
    userSelections: [
      { filePath: "ChatInput.tsx", rangeText: "L412-L468" },
    ],
    additionalDirs: [
      { name: "shared", scope: "project" },
      { name: "scripts", scope: "session" },
    ],
  },
}
