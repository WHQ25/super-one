"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import {
  ActivityPanelMock,
  AskUserQuestionMock,
  BrowserCloseResultMock,
  ChatInputAdvancedMock,
  ChatStatusBarMock,
  CollaborationMock,
  FilePreviewMock,
  FileTreeMock,
  McpSlashPopupMock,
  NewSessionMock,
  PermissionPromptMock,
  PlanApprovalMock,
  RealtimeVoiceMock,
  SAMPLE_FILE_TREE,
  SideChatMock,
  SubagentBlockMock,
  TerminalPanelMock,
  TodoPopupMock,
  ToolBlockMock,
  TurnDetailMock,
} from "@superone/desktop-mocks/desktop"
import { cn } from "@superone/ui/lib/utils"
import { BrandedSurface } from "@/components/branded-surface"

const PLAN = `## Align the web showcase with the desktop release

1. Reuse the production mock package for every product surface.
2. Keep brand hue scoped to each simulated desktop surface.
3. Verify the localized routes stay statically rendered.

The marketing page remains a thin composition layer over shared mocks.`

const QUESTIONS = [
  {
    header: "Release scope",
    question: "Which validation should run before publishing the updated gallery?",
    options: [
      {
        label: "Typecheck and production build",
        description: "Covers route types, client boundaries, and the final asset graph.",
      },
      {
        label: "Typecheck only",
        description: "Fast, but does not verify static route generation.",
      },
      {
        label: "Visual review only",
        description: "Useful for polish, but misses compile-time regressions.",
      },
    ],
  },
]

const TODO_ITEMS = [
  { id: "1", text: "Inventory desktop surfaces on latest main", status: "completed" as const },
  { id: "2", text: "Add realtime voice and side chat showcases", status: "completed" as const },
  { id: "3", text: "Validate localized production routes", status: "in_progress" as const },
  { id: "4", text: "Capture the refreshed gallery", status: "pending" as const },
]

interface DemoCardProps {
  title: string
  description: string
  children: ReactNode
  wide?: boolean
  surfaceClassName?: string
}

function DemoCard({
  title,
  description,
  children,
  wide = false,
  surfaceClassName = "p-2",
}: DemoCardProps) {
  return (
    <article className={wide ? "flex flex-col gap-4 xl:col-span-2" : "flex flex-col gap-4"}>
      <header className="flex flex-col gap-1 px-1">
        <h3 className="text-base font-medium tracking-tight">{title}</h3>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </header>
      <BrandedSurface
        className={cn(
          "overflow-hidden rounded-2xl shadow-sm ring-1 ring-border",
          surfaceClassName,
        )}
      >
        {children}
      </BrandedSurface>
    </article>
  )
}

interface DemoSectionProps {
  id: string
  title: string
  description: string
  children: ReactNode
}

function DemoSection({ id, title, description, children }: DemoSectionProps) {
  return (
    <section id={id} className="flex scroll-mt-24 flex-col gap-8">
      <div className="flex max-w-3xl flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        <p className="text-base leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-10 xl:grid-cols-2">{children}</div>
    </section>
  )
}

export function DemosGallery() {
  const t = useTranslations("Demos")

  return (
    <div className="flex flex-col gap-24">
      <DemoSection
        id="workspace"
        title={t("sections.workspace.title")}
        description={t("sections.workspace.description")}
      >
        <DemoCard
          title={t("cards.newSession.title")}
          description={t("cards.newSession.description")}
          wide
          surfaceClassName="overflow-x-auto p-2"
        >
          <div className="min-w-[52rem]">
            <NewSessionMock
              defaultHarness="codex"
              height={640}
              showActivityPanelToggle
              showTerminalToggle
            />
          </div>
        </DemoCard>

        <DemoCard
          title={t("cards.composer.title")}
          description={t("cards.composer.description")}
          wide
          surfaceClassName="p-5"
        >
          <div className="pt-44">
            <ChatInputAdvancedMock
              harness="codex"
              value="/si"
              slashPopup={{
                query: "si",
                activeIndex: 0,
                commands: [
                  {
                    name: "side",
                    description: "Open a temporary side chat that inherits this conversation",
                    matchIndices: [0, 1],
                  },
                  {
                    name: "skill-creator",
                    description: "Create or update a reusable Codex skill",
                    isSkill: true,
                    matchIndices: [0],
                  },
                ],
              }}
              backgroundAgents={2}
              voiceState="idle"
            />
          </div>
        </DemoCard>
      </DemoSection>

      <DemoSection
        id="conversation"
        title={t("sections.conversation.title")}
        description={t("sections.conversation.description")}
      >
        <DemoCard
          title={t("cards.realtime.title")}
          description={t("cards.realtime.description")}
        >
          <RealtimeVoiceMock
            defaultView="realtime"
            defaultVoiceState="active"
            speakingSegmentIds={["call-2-assistant-1"]}
          />
        </DemoCard>

        <DemoCard
          title={t("cards.activity.title")}
          description={t("cards.activity.description")}
          surfaceClassName="h-[42rem] p-2"
        >
          <ActivityPanelMock className="h-full" />
        </DemoCard>

        <DemoCard
          title={t("cards.sideChat.title")}
          description={t("cards.sideChat.description")}
          surfaceClassName="h-[38rem] p-2"
        >
          <SideChatMock
            className="h-full"
            harness="codex"
            parentTitle="Audit the release UI against latest main"
          />
        </DemoCard>

        <DemoCard
          title={t("cards.turnDetails.title")}
          description={t("cards.turnDetails.description")}
          surfaceClassName="p-6"
        >
          <TurnDetailMock expanded />
        </DemoCard>
      </DemoSection>

      <DemoSection
        id="coordination"
        title={t("sections.coordination.title")}
        description={t("sections.coordination.description")}
      >
        <DemoCard
          title={t("cards.collaboration.title")}
          description={t("cards.collaboration.description")}
          wide
          surfaceClassName="p-5"
        >
          <CollaborationMock />
        </DemoCard>

        <DemoCard
          title={t("cards.subagent.title")}
          description={t("cards.subagent.description")}
          surfaceClassName="p-5"
        >
          <SubagentBlockMock
            state="running"
            expanded
            async
            color="blue"
            subagentType="code-reviewer"
            description="Verify cross-harness UI coverage"
            prompt="Review the new web gallery against current desktop behavior and report any missing surfaces."
            liveActivityText="Checking realtime voice, activity tabs, and collaboration states"
            asyncToolHistory={[
              { toolName: "Read", description: "desktop release components" },
              { toolName: "Typecheck", description: "web workspace", isActive: true },
            ]}
            elapsedSec={18}
            totalTokens={14260}
          />
        </DemoCard>

        <DemoCard
          title={t("cards.browserClose.title")}
          description={t("cards.browserClose.description")}
          surfaceClassName="p-5"
        >
          <div className="flex flex-col gap-3">
            <BrowserCloseResultMock
              closedTabs={["SuperOne docs", "Storybook"]}
              failedTabs={[{ tab: "release-preview", reason: "Tab is no longer available" }]}
            />
            <BrowserCloseResultMock closedTabs={["Docs", "Preview", "Storybook"]} />
          </div>
        </DemoCard>
      </DemoSection>

      <DemoSection
        id="decisions"
        title={t("sections.decisions.title")}
        description={t("sections.decisions.description")}
      >
        <DemoCard
          title={t("cards.permission.title")}
          description={t("cards.permission.description")}
          surfaceClassName="p-4"
        >
          <PermissionPromptMock
            spec={{ variant: "bash", command: "bun --filter @superone/web build" }}
            description="verify static rendering and the production client graph"
            suggestions={[
              { label: "Allow this exact build command", selected: true },
              { label: "Allow Bun builds for this project" },
            ]}
          />
        </DemoCard>

        <DemoCard
          title={t("cards.question.title")}
          description={t("cards.question.description")}
          surfaceClassName="p-4"
        >
          <AskUserQuestionMock
            questions={QUESTIONS}
            selections={{
              [QUESTIONS[0].question]: QUESTIONS[0].options[0].label,
            }}
          />
        </DemoCard>

        <DemoCard
          title={t("cards.plan.title")}
          description={t("cards.plan.description")}
          wide
          surfaceClassName="h-[38rem] p-2"
        >
          <PlanApprovalMock
            fileName="refresh-web-showcase.plan.md"
            planContent={PLAN}
            allowedPrompts={[
              { tool: "Edit", prompt: "apps/web" },
              { tool: "Bash", prompt: "web typecheck and build" },
            ]}
            switchAfterApproval
            fastModeTarget="auto"
          />
        </DemoCard>
      </DemoSection>

      <DemoSection
        id="tools"
        title={t("sections.tools.title")}
        description={t("sections.tools.description")}
      >
        <DemoCard
          title={t("cards.toolBlocks.title")}
          description={t("cards.toolBlocks.description")}
          surfaceClassName="p-5"
        >
          <div className="flex flex-col gap-3">
            <ToolBlockMock
              expanded
              spec={{
                variant: "edit",
                filePath: "apps/web/app/[locale]/demos/page.tsx",
                startLine: 1,
                oldText: "return <h1>Demos</h1>",
                newText: "return <DemosGallery />",
              }}
            />
            <ToolBlockMock
              isStreaming
              spec={{ variant: "bash", command: "bun --filter @superone/web build" }}
            />
          </div>
        </DemoCard>

        <DemoCard
          title={t("cards.todo.title")}
          description={t("cards.todo.description")}
          surfaceClassName="p-5"
        >
          <TodoPopupMock items={TODO_ITEMS} expanded openRowIds={["3"]} />
        </DemoCard>

        <DemoCard
          title={t("cards.status.title")}
          description={t("cards.status.description")}
          surfaceClassName="p-5"
        >
          <div className="flex flex-col gap-4">
            <ChatStatusBarMock
              harness="codex"
              branch="web/index"
              branchDirty
            />
            <McpSlashPopupMock variant="live" harness="codex" />
          </div>
        </DemoCard>

        <DemoCard
          title={t("cards.terminal.title")}
          description={t("cards.terminal.description")}
          surfaceClassName="h-[22rem] p-2"
        >
          <TerminalPanelMock className="h-full" />
        </DemoCard>
      </DemoSection>

      <DemoSection
        id="files"
        title={t("sections.files.title")}
        description={t("sections.files.description")}
      >
        <DemoCard
          title={t("cards.fileTree.title")}
          description={t("cards.fileTree.description")}
          surfaceClassName="h-[34rem] p-2"
        >
          <FileTreeMock
            rootName="super-one"
            nodes={SAMPLE_FILE_TREE}
            selectedPath="packages/desktop-mocks/src/desktop/realtime-voice-mock.tsx"
          />
        </DemoCard>

        <DemoCard
          title={t("cards.filePreview.title")}
          description={t("cards.filePreview.description")}
          surfaceClassName="h-[34rem] p-2"
        >
          <FilePreviewMock
            spec={{
              kind: "diff",
              filePath: "apps/web/app/[locale]/page.tsx",
              startLine: 22,
              oldText: "<div>Simulated app surface</div>",
              newText: "<ProductShowcase />",
            }}
          />
        </DemoCard>
      </DemoSection>
    </div>
  )
}
