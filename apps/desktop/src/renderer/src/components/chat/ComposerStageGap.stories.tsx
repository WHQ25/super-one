import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { AskUserQuestionRequest } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import { publishComposerOverhang, useChatScroll } from '@/hooks/useChatScroll'
import { useChatStore } from '@/stores/chat'
import { ComposerSwitch } from './ComposerSwitch'
import { DecisionComposer } from './DecisionComposer'
import { COMPOSER_CONTENT_MAX_HEIGHT } from './composer-slot/composer-registry'

const QUESTION: AskUserQuestionRequest = {
  requestId: 'stage-gap-question',
  questions: [{
    question: '你希望优先评估哪个运行场景的性能？',
    header: '场景',
    multiSelect: false,
    options: [
      { label: '默认环境（推荐）', description: '先看本地开发机。' },
      { label: '生产环境', description: '看线上机器。' },
    ],
  }],
}

/** Keeps the question live so the card is not inert and can take focus. */
function SeedQuestion() {
  useEffect(() => {
    const previous = useChatStore.getState()
    const apply = () => {
      useChatStore.setState((state) => {
        const projectPath = state.activeProject
        const project = projectPath ? state.projectSessions[projectPath] : null
        const sessionId = project?._activeSessionId
        const session = sessionId ? project?._sessions[sessionId] : null
        if (!projectPath || !project || !sessionId || !session) return state
        return {
          projectSessions: {
            ...state.projectSessions,
            [projectPath]: {
              ...project,
              _sessions: {
                ...project._sessions,
                [sessionId]: { ...session, pendingPermissions: [], pendingQuestion: QUESTION, messages: session.messages },
              },
            },
          },
        }
      })
    }
    apply()
    const timer = window.setTimeout(apply, 0)
    return () => {
      window.clearTimeout(timer)
      useChatStore.setState(previous)
    }
  }, [])
  return null
}

function StageGapPreview({ glass = false, kind = 'decision' }: { glass?: boolean; kind?: 'text' | 'decision' }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const grew = useRef(false)
  const [lines, setLines] = useState(1)
  useChatScroll({ scrollViewportRef: scrollRef })
  const publishOverhang = useCallback((px: number) => {
    publishComposerOverhang(rootRef.current, px)
  }, [])
  // Measure the short text composer first, then grow it, so the extra lines overhang.
  useLayoutEffect(() => {
    if (kind !== 'text' || grew.current) return
    grew.current = true
    setLines(6)
  }, [kind])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [kind, lines, glass])

  let composer: ReactNode
  if (kind === 'decision') {
    composer = <DecisionComposer item={{ kind: 'question', request: QUESTION }} />
  } else {
    composer = (
      <div className="mx-3 mb-1 rounded-xl border border-border px-3 py-2 text-sm text-foreground">
        {Array.from({ length: lines }, (_, index) => <p key={index} className="m-0">草稿第 {index + 1} 行</p>)}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3" style={{ width: 760, maxWidth: '100%' }}>
      <p className="m-0 text-xs text-muted-foreground">输入框上方 12px 应透出记录。提问卡贴到焦点环处，上方不应再有一条实边。玻璃模式下，主体里不应再看到这些字。</p>
      <SeedQuestion />
      <div className={cn('rounded-xl p-4', glass && 'liquid-glass dark')} style={glass ? { background: 'linear-gradient(135deg, #315070, #7a4d73)' } : undefined}>
        <div ref={rootRef} data-chat-root="" className="flex h-[520px] flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div data-transcript-frame="" className="flex min-h-0 min-w-0 flex-1 flex-col -mb-3">
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-2 p-3">
                {Array.from({ length: 18 }, (_, index) => (
                  <div key={index} className="rounded-md bg-muted px-3 py-2 text-xs text-foreground">记录第 {index + 1} 行，用来看它会不会穿进 composer。</div>
                ))}
              </div>
            </div>
          </div>
          <ComposerSwitch
            kind={kind}
            align={{ kind: 'decision', to: 'text' }}
            onOverhangChange={publishOverhang}
            maxHeight={kind === 'text' ? undefined : COMPOSER_CONTENT_MAX_HEIGHT}
            render={() => composer}
          />
        </div>
      </div>
    </div>
  )
}

const meta = {
  title: 'Chat/ComposerStageGap',
  component: StageGapPreview,
  parameters: { layout: 'padded' },
  globals: { theme: 'dark' },
} satisfies Meta<typeof StageGapPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Question: Story = { args: { kind: 'decision', glass: false } }
export const QuestionGlass: Story = { args: { kind: 'decision', glass: true } }
export const Text: Story = { args: { kind: 'text', glass: false } }
export const TextGlass: Story = { args: { kind: 'text', glass: true } }
