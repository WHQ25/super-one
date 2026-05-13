import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion"
import {
  AskUserQuestionMock,
  BrandScope,
  ChatMock,
  HARNESS_CLAUDE_HUE,
  type Harness,
  type MockMessage,
  type MockUserQuestion,
} from "@superone/desktop-mocks"

export const ASK_USER_QUESTION_FPS = 30
export const ASK_USER_QUESTION_WIDTH = 1280
export const ASK_USER_QUESTION_HEIGHT = 800
export const ASK_USER_QUESTION_DURATION_IN_FRAMES = 14 * ASK_USER_QUESTION_FPS

export type AskUserQuestionSceneProps = {
  harness: Harness
  brandHue: number
  darkMode: boolean
}

export const askUserQuestionSceneDefaultProps: AskUserQuestionSceneProps = {
  harness: "claude",
  brandHue: HARNESS_CLAUDE_HUE,
  darkMode: false,
}

const QUESTIONS: MockUserQuestion[] = [
  {
    header: "Approach",
    question: "Which mock strategy fits the desktop video pipeline?",
    options: [
      {
        label: "Frame-driven dual-mode (Recommended)",
        description:
          "Same component, optional `frame` prop time-drives reveal. Web/Storybook stays static; Remotion gets streaming.",
        preview: `### Frame-driven dual-mode\n\nOne component, two modes:\n\n- web/Storybook → frame undefined → original render\n- Remotion → frame number → typing animation\n\n\`\`\`ts\nframe === undefined ? messages : computeReveal(messages, ms)\n\`\`\`\n\n> Trade-off: extra logic, but no duplicated rendering code.`,
      },
      {
        label: "Snapshot HTML to PNG",
        description: "Render web, screenshot, embed in Remotion as <Img>. No interactivity.",
        preview:
          "### Snapshot HTML to PNG\n\nFast to build, can't animate, scales poorly.\n\n- Manual capture per frame\n- Can't react to brand hue switches\n- Wastes the React renderer Remotion already provides",
      },
      {
        label: "Build a separate mock library",
        description: "Duplicate logic in `video-mocks/`. Two truths to keep in sync.",
        preview:
          "### Duplicate mock library\n\nForks divergence:\n\n- Web mock and video mock drift apart\n- Bug fixes need two PRs\n- Visual parity becomes manual QA",
      },
    ],
  },
  {
    header: "Coverage",
    question: "Which mocks should we ship together?",
    multiSelect: true,
    options: [
      { label: "ChatMock", description: "Streaming markdown + tool blocks." },
      { label: "ToolBlockMock", description: "All tool variants — Bash, Edit, Read, etc." },
      { label: "PermissionPromptMock", description: "Default + codex_decision + sandbox + elicitation." },
      { label: "AskUserQuestionMock", description: "Simple + preview + multi-tab." },
      { label: "FileTreeMock", description: "Static tree with git status colors." },
      { label: "FilePreviewMock", description: "Code / markdown / image / diff." },
    ],
  },
]

const CONVERSATION: MockMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "Let's lock in the desktop video mock approach.",
  },
  {
    id: "a1",
    role: "assistant",
    blocks: [
      {
        type: "markdown",
        text:
          "Two questions before we proceed — pick an approach, then mark which mocks ship in v1. I'll wait for both.",
      },
    ],
  },
]

export const AskUserQuestionScene = ({
  harness,
  brandHue,
  darkMode,
}: AskUserQuestionSceneProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps

  let activeTabIndex = 0
  let selections: Record<string, string> = {}
  let feedbackFocused = false

  if (t < 1) {
    activeTabIndex = 0
    selections = {}
  } else if (t < 3.5) {
    activeTabIndex = 0
    selections = { [QUESTIONS[0].question]: QUESTIONS[0].options[0].label }
  } else if (t < 5.5) {
    activeTabIndex = 0
    selections = { [QUESTIONS[0].question]: QUESTIONS[0].options[1].label }
  } else if (t < 6.5) {
    activeTabIndex = 0
    selections = { [QUESTIONS[0].question]: QUESTIONS[0].options[0].label }
  } else if (t < 9) {
    activeTabIndex = 1
    selections = {
      [QUESTIONS[0].question]: QUESTIONS[0].options[0].label,
      [QUESTIONS[1].question]: [
        QUESTIONS[1].options[0].label,
        QUESTIONS[1].options[1].label,
        QUESTIONS[1].options[2].label,
      ].join(", "),
    }
    feedbackFocused = false
  } else {
    activeTabIndex = 1
    selections = {
      [QUESTIONS[0].question]: QUESTIONS[0].options[0].label,
      [QUESTIONS[1].question]: QUESTIONS[1].options.map((o) => o.label).join(", "),
    }
    feedbackFocused = false
  }

  const shellOpacity = interpolate(frame, [0, 0.4 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return (
    <BrandScope brandHue={brandHue} darkMode={darkMode}>
      <AbsoluteFill className="items-center justify-center bg-muted p-6">
        <div
          style={{ width: 1232, height: 752, opacity: shellOpacity }}
          className="overflow-hidden rounded-2xl shadow-2xl ring-1 ring-border/60"
        >
          <ChatMock
            title="AskUserQuestion preview"
            harness={harness}
            messages={CONVERSATION}
            placeholder="Answer with number keys or Tab to switch"
            showTrafficLights
            askUserQuestion={
              <AskUserQuestionMock
                questions={QUESTIONS}
                activeTabIndex={activeTabIndex}
                selections={selections}
                feedbackFocused={feedbackFocused}
              />
            }
          />
        </div>
      </AbsoluteFill>
    </BrandScope>
  )
}
