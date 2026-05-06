import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, type ReactNode } from 'react'
import { AskUserQuestionPrompt } from './AskUserQuestionPrompt'
import { useChatStore } from '@/stores/chat'
import type { AskUserQuestionRequest } from '@superone/shared/agent-types'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function SeedQuestion({ request }: { request: AskUserQuestionRequest | null }) {
  useEffect(() => {
    const apply = (): void => {
      useChatStore.setState((s) => {
        const projectId = s.activeProject
        if (!projectId) return s
        const project = s.projectSessions[projectId]
        if (!project) return s
        const sid = project._activeSessionId
        if (!sid) return s
        const session = project._sessions[sid]
        if (!session) return s
        return {
          projectSessions: {
            ...s.projectSessions,
            [projectId]: {
              ...project,
              _sessions: {
                ...project._sessions,
                [sid]: { ...session, pendingQuestion: request },
              },
            },
          },
        }
      })
    }
    apply()
    const t = setTimeout(apply, 0)
    return () => clearTimeout(t)
  }, [request])
  return null
}

const meta: Meta<typeof AskUserQuestionPrompt> = {
  title: 'ClaudeCode/AskUserQuestionPrompt',
  component: AskUserQuestionPrompt,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell width={820}><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof AskUserQuestionPrompt>

export const SingleSelect: Story = {
  decorators: [(Story) => (
    <>
      <SeedQuestion request={{
        requestId: 'q-single',
        questions: [{
          question: 'Which provider should bootstrap the new session?',
          header: 'Provider',
          multiSelect: false,
          options: [
            { label: 'Claude', description: 'Anthropic Claude via the Agent SDK (default).' },
            { label: 'Codex', description: 'OpenAI Codex experimental backend.' },
          ],
        }],
      }} />
      <Story />
    </>
  )],
}

export const MultiSelect: Story = {
  decorators: [(Story) => (
    <>
      <SeedQuestion request={{
        requestId: 'q-multi',
        questions: [{
          question: 'Which platforms to package?',
          header: 'Platforms',
          multiSelect: true,
          options: [
            { label: 'macOS', description: 'DMG + ZIP universal binary.' },
            { label: 'Windows', description: 'NSIS installer (x64 + arm64).' },
            { label: 'Linux', description: 'AppImage (x64 + arm64).' },
          ],
        }],
      }} />
      <Story />
    </>
  )],
}

export const WithPreviews: Story = {
  decorators: [(Story) => (
    <>
      <SeedQuestion request={{
        requestId: 'q-preview',
        questions: [{
          question: 'Pick the changelog entry style:',
          header: 'Changelog',
          multiSelect: false,
          options: [
            {
              label: 'Conventional',
              description: 'Type-scope-subject prefix.',
              preview: '### Features\n\n- **chat**: subagent multi-color rendering\n- **mcp**: support for in-chat mini-app result template\n\n### Fixes\n\n- **ui**: remove focus ring on project selector items',
            },
            {
              label: 'Narrative',
              description: 'Prose-style summary.',
              preview: 'This release adds richer subagent rendering — each Task now picks a stable color so concurrent agents are easy to tell apart. The MCP layer learned a new in-chat mini-app result template.',
            },
            {
              label: 'Bullet List',
              description: 'Flat bullet list, no grouping.',
              preview: '- Subagent multi-color rendering\n- In-chat mini-app result template\n- Project selector focus ring removed',
            },
          ],
        }],
      }} />
      <Story />
    </>
  )],
}

export const MultipleQuestions: Story = {
  decorators: [(Story) => (
    <>
      <SeedQuestion request={{
        requestId: 'q-multi-q',
        questions: [
          {
            question: 'Bump kind?',
            header: 'Bump',
            multiSelect: false,
            options: [
              { label: 'patch', description: '0.26.0 → 0.26.1' },
              { label: 'minor', description: '0.26.0 → 0.27.0' },
              { label: 'major', description: '0.26.0 → 1.0.0' },
            ],
          },
          {
            question: 'Channel?',
            header: 'Channel',
            multiSelect: false,
            options: [
              { label: 'alpha', description: 'Internal preview, GitHub prerelease=true.' },
              { label: 'beta', description: 'Wider preview ring.' },
              { label: 'public', description: 'Stable release.' },
            ],
          },
        ],
      }} />
      <Story />
    </>
  )],
}

export const NoPending: Story = {
  decorators: [(Story) => (
    <>
      <SeedQuestion request={null} />
      <Story />
    </>
  )],
}
