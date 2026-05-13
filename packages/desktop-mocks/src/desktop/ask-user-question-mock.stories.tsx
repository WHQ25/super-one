import type { Meta, StoryObj } from "@storybook/react-vite"
import { AskUserQuestionMock, type MockUserQuestion } from "./ask-user-question-mock"

const meta: Meta<typeof AskUserQuestionMock> = {
  title: "Desktop Mocks/AskUserQuestionMock",
  component: AskUserQuestionMock,
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

type Story = StoryObj<typeof AskUserQuestionMock>

const simpleQuestion: MockUserQuestion = {
  header: "Auth strategy",
  question: "Which auth flow should we ship first?",
  options: [
    { label: "OAuth 2.1 with PKCE", description: "Best for native desktop, no client secrets." },
    { label: "Magic-link email", description: "Lowest friction, slower." },
    { label: "Passkeys", description: "Modern but limited platform support." },
  ],
}

const previewQuestion: MockUserQuestion = {
  header: "Approach",
  question: "Which mock strategy fits the desktop video pipeline?",
  options: [
    {
      label: "Frame-driven dual-mode",
      description:
        "Same component, optional `frame` prop time-drives reveal. Web/Storybook stays static; Remotion gets streaming.",
      preview: `### Frame-driven dual-mode\n\nOne component, two modes:\n\n- web/Storybook → frame undefined → original render\n- Remotion → frame number → typing animation\n\n\`useState(frame)\``,
    },
    {
      label: "Snapshot HTML to PNG",
      description: "Render web, screenshot, embed in Remotion as <Img>. No interactivity.",
      preview: "### Snapshot HTML to PNG\n\nFast to build, can't animate, scales poorly.",
    },
  ],
}

const multiQuestion: MockUserQuestion = {
  header: "Coverage",
  question: "Which mocks should we ship together?",
  multiSelect: true,
  options: [
    { label: "ChatMock" },
    { label: "ToolBlockMock" },
    { label: "PermissionPromptMock" },
    { label: "AskUserQuestionMock" },
    { label: "FileTreeMock" },
    { label: "FilePreviewMock" },
  ],
}

export const Simple: Story = {
  args: {
    questions: [simpleQuestion],
    selections: { [simpleQuestion.question]: simpleQuestion.options[0].label },
  },
}

export const SimpleOtherFocused: Story = {
  args: {
    questions: [simpleQuestion],
    selections: {},
    otherTexts: { [simpleQuestion.question]: "Custom passwordless flow" },
    feedbackFocused: true,
  },
}

export const Preview: Story = {
  args: {
    questions: [previewQuestion],
    selections: { [previewQuestion.question]: previewQuestion.options[0].label },
    noteText: "Picked because Remotion already runs the React renderer per frame.",
  },
}

export const MultiTab: Story = {
  args: {
    questions: [previewQuestion, multiQuestion],
    activeTabIndex: 1,
    selections: {
      [previewQuestion.question]: previewQuestion.options[0].label,
      [multiQuestion.question]: [
        multiQuestion.options[0].label,
        multiQuestion.options[1].label,
        multiQuestion.options[2].label,
      ].join(", "),
    },
  },
}

export const MultiSelectAll: Story = {
  args: {
    questions: [multiQuestion],
    selections: {
      [multiQuestion.question]: multiQuestion.options.map((o) => o.label).join(", "),
    },
  },
}
