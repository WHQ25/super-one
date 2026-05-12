import type { Meta, StoryObj } from "@storybook/react-vite"
import { ChatMock, type MockMessage } from "./chat-mock"

const SHORT_MESSAGES: MockMessage[] = [
  { id: "s1", role: "user", text: "Help me write a quick smoke test." },
  {
    id: "s2",
    role: "assistant",
    text: "Sure — what should it exercise? I'll target the happy path first and keep the assertions minimal.",
  },
]

const LONG_MESSAGES: MockMessage[] = Array.from({ length: 30 }, (_, i) => {
  const role: MockMessage["role"] = i % 2 === 0 ? "user" : "assistant"
  const userTexts = [
    "Let's keep iterating on the sidebar.",
    "Pull the latest from main and rebase.",
    "Can you also wire up the keyboard shortcut?",
    "What's the deal with the stale folder cache?",
    "Show me the diff for the changes so far.",
  ]
  const assistantTexts = [
    "Got it — I'll start with the smallest change that makes the test green.",
    "Rebased cleanly. Two trivial conflicts in CHANGELOG that I resolved by keeping both entries.",
    "Cmd+Shift+[ now collapses the active project. I mirrored the pattern from the tab switcher hook.",
    "The stale cache comes from `_folderSessionsRef` not being invalidated after `refresh`. Adding an explicit clear before reload.",
    "Diff below — only three files touched: AppSidebar.tsx, useKeyboardShortcuts.ts, and the new test.",
  ]
  return {
    id: `m${i}`,
    role,
    text: role === "user" ? userTexts[i % userTexts.length] : assistantTexts[i % assistantTexts.length],
  }
})

const meta: Meta<typeof ChatMock> = {
  title: "Web/Mocks/Desktop/ChatMock",
  component: ChatMock,
  parameters: { layout: "centered" },
  args: {
    title: "Refactor sidebar layout",
    autoScroll: false,
  },
  decorators: [
    (Story) => (
      <div style={{ width: 1280, height: 800 }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    title: { control: "text" },
    placeholder: { control: "text" },
    autoScroll: { control: "boolean" },
  },
}

export default meta
type Story = StoryObj<typeof ChatMock>

export const Default: Story = {}

export const ShortConversation: Story = {
  args: {
    title: "Quick smoke test",
    messages: SHORT_MESSAGES,
  },
}

export const LongScroll: Story = {
  args: {
    title: "Long iteration thread",
    messages: LONG_MESSAGES,
  },
}

export const AutoScrollToBottom: Story = {
  args: {
    title: "Long thread (auto-scrolled)",
    messages: LONG_MESSAGES,
    autoScroll: true,
  },
}
