import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'

/**
 * SuperOne session_collab_* MCP tool UI
 * (`session_collab_request` / `session_collab_start` / `session_collab_send` / `session_collab_retrieve`).
 */

const PREFIX = 'mcp__superone__'

function StoryShell({ children, width = 560 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container space-y-3" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function block(
  tool: string,
  input: Record<string, unknown>,
  opts: {
    status?: 'streaming' | 'complete'
    result?: string
    isError?: boolean
    elapsedSeconds?: number
  } = {},
) {
  return (
    <ToolBlock
      toolName={`${PREFIX}${tool}`}
      input={JSON.stringify(input)}
      status={opts.status ?? 'complete'}
      result={opts.result}
      isError={opts.isError}
      elapsedSeconds={opts.elapsedSeconds}
    />
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

const LAUNCHES_ONE = {
  launches: [
    {
      launchId: 'reviewer',
      agentId: 'acp-base',
      name: 'DiffBot',
      role: 'Reviewer',
      summary: 'Review the diff (read-only)',
      task: 'Review the diff and report issues only.',
    },
  ],
}

const LAUNCHES_TWO = {
  launches: [
    {
      launchId: 'alpha',
      agentId: 'claude-base',
      name: 'Alice',
      role: 'Reviewer',
      summary: 'Review focused test failures',
      task: 'Review the focused test failures and report the root cause.',
    },
    {
      launchId: 'beta',
      agentId: 'codex-base',
      name: 'Bob',
      role: 'Implementer',
      summary: 'Implement the approved fix',
      task: 'Implement the approved fix.',
    },
  ],
}

const CRED_A = 's1sc_demo_credential_aaaa'
const CRED_B = 's1sc_demo_credential_bbbb'

const START_RESULT = {
  status: 'started',
  sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  reused: false,
  name: 'DiffBot',
  role: 'Reviewer',
  title: 'DiffBot - Reviewer',
  config: {
    model: 'grok-4.5',
    effort: 'high',
    permissionMode: 'default',
    sandboxMode: 'off',
    cwd: '/Users/me/projects/super-one',
    name: 'DiffBot',
    role: 'Reviewer',
  },
}

const meta: Meta = {
  title: 'SuperOne/MCP Tools/Collab',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj

export const Gallery: Story = {
  name: 'Gallery (all states)',
  render: () => (
    <StoryShell width={640}>
      <Section title="session_collab_request">
        {block('session_collab_request', LAUNCHES_ONE, { status: 'streaming', elapsedSeconds: 1 })}
        {block('session_collab_request', LAUNCHES_ONE, {
          result: JSON.stringify({
            status: 'approved',
            launches: [{
              launchId: 'reviewer',
              agentId: 'acp-base',
              name: 'DiffBot',
              role: 'Reviewer',
              title: 'DiffBot - Reviewer',
              credential: CRED_A,
            }],
          }),
        })}
        {block('session_collab_request', LAUNCHES_TWO, { status: 'streaming', elapsedSeconds: 2 })}
        {block('session_collab_request', LAUNCHES_TWO, {
          result: JSON.stringify({
            status: 'approved',
            launches: [
              { launchId: 'alpha', name: 'Alice', role: 'Reviewer', title: 'Alice - Reviewer', credential: CRED_A },
              { launchId: 'beta', name: 'Bob', role: 'Implementer', title: 'Bob - Implementer', credential: CRED_B },
            ],
          }),
        })}
      </Section>

      <Section title="session_collab_start">
        {block('session_collab_start', { credential: CRED_A }, { status: 'streaming', elapsedSeconds: 4 })}
        {block('session_collab_start', { credential: CRED_A }, {
          result: JSON.stringify(START_RESULT),
        })}
      </Section>

      <Section title="session_collab_send (Send icon) — To + Markdown body">
        {block('session_collab_send', {
          credential: CRED_A,
          content: 'ping-1 — please reply with status.',
        }, { status: 'streaming', elapsedSeconds: 1 })}
        {block('session_collab_send', {
          credential: CRED_A,
          content: [
            '## Auth review brief',
            '',
            'Please review the auth changes and **report issues only**.',
            '',
            '### Focus',
            '- permission checks',
            '- token expiry',
            '- CSRF',
            '',
            'Ignore style nits. Return a short verdict plus `file:line` bullets when you find problems.',
            '',
            'This trailing paragraph is long enough that the Markdown body should clamp until expanded in the tool UI.',
          ].join('\n'),
        }, {
          result: JSON.stringify({
            status: 'sent',
            messageId: 'msg-1',
            sequence: 1,
            peerSessionId: 'child-diffbot',
            to: {
              name: 'DiffBot',
              role: 'Reviewer',
              title: 'DiffBot - Reviewer',
              sessionId: 'child-diffbot',
            },
          }),
        })}
      </Section>

      <Section title="session_collab_retrieve (Inbox icon) — From + Markdown body">
        {block('session_collab_retrieve', {
          credentials: [CRED_A],
        }, { status: 'streaming', elapsedSeconds: 1 })}
        {block('session_collab_retrieve', {
          credentials: [CRED_A],
        }, {
          result: JSON.stringify({
            status: 'empty',
            peers: [{
              credential: CRED_A,
              name: 'DiffBot',
              role: 'Reviewer',
              title: 'DiffBot - Reviewer',
              sessionId: 'child-diffbot',
            }],
            messages: [],
          }),
        })}
        {block('session_collab_retrieve', {
          credentials: [CRED_A],
        }, {
          result: JSON.stringify({
            status: 'messages',
            peers: [{
              credential: CRED_A,
              name: 'DiffBot',
              role: 'Reviewer',
              title: 'DiffBot - Reviewer',
              sessionId: 'child-diffbot',
            }],
            messages: [{
              content: [
                '## Verdict: **needs fix**',
                '',
                '| Area | Issue |',
                '| --- | --- |',
                '| Auth | missing CSRF on POST `/login` |',
                '| Token | refresh path races logout |',
                '',
                '```ts',
                'if (!csrf.valid(req)) return 403',
                '```',
                '',
                'Line 4+ keeps going so clamp/expand is exerciseable in Storybook.',
              ].join('\n'),
              fromSessionId: 'child-diffbot',
              from: {
                name: 'DiffBot',
                role: 'Reviewer',
                title: 'DiffBot - Reviewer',
                sessionId: 'child-diffbot',
              },
            }],
          }),
        })}
        {block('session_collab_retrieve', {
          credentials: [CRED_A, CRED_B],
        }, {
          result: JSON.stringify({
            status: 'messages',
            peers: [
              { name: 'Alice', role: 'Reviewer', title: 'Alice - Reviewer', sessionId: 'child-alice' },
              { name: 'Bob', role: 'Implementer', title: 'Bob - Implementer', sessionId: 'child-bob' },
            ],
            messages: [
              {
                content: [
                  '### Alice findings',
                  '1. auth path',
                  '2. missing test',
                  '3. n+1 query',
                ].join('\n'),
                fromSessionId: 'child-alice',
                from: { name: 'Alice', role: 'Reviewer', title: 'Alice - Reviewer', sessionId: 'child-alice' },
              },
              {
                content: '**beta-pong-1** — implementer ack, starting fix.',
                fromSessionId: 'child-bob',
                from: { name: 'Bob', role: 'Implementer', title: 'Bob - Implementer', sessionId: 'child-bob' },
              },
            ],
          }),
        })}
      </Section>
    </StoryShell>
  ),
}

export const ParentTurnFlow: Story = {
  name: 'Flow · parent happy path',
  render: () => (
    <StoryShell width={640}>
      <Section title="1. Request">
        {block('session_collab_request', LAUNCHES_TWO, {
          result: JSON.stringify({
            status: 'approved',
            launches: [
              { name: 'Alice', role: 'Reviewer', title: 'Alice - Reviewer', credential: CRED_A },
              { name: 'Bob', role: 'Implementer', title: 'Bob - Implementer', credential: CRED_B },
            ],
          }),
        })}
      </Section>
      <Section title="2. Start">
        {block('session_collab_start', { credential: CRED_A }, {
          result: JSON.stringify({
            ...START_RESULT,
            name: 'Alice',
            role: 'Reviewer',
            title: 'Alice - Reviewer',
            config: { ...START_RESULT.config, name: 'Alice', role: 'Reviewer', model: 'claude-sonnet' },
          }),
        })}
        {block('session_collab_start', { credential: CRED_B }, {
          result: JSON.stringify({
            status: 'started',
            sessionId: '22222222-2222-2222-2222-222222222222',
            name: 'Bob',
            role: 'Implementer',
            title: 'Bob - Implementer',
            config: { model: 'gpt-5.4', name: 'Bob', role: 'Implementer', cwd: '/Users/me/projects/super-one' },
          }),
        })}
      </Section>
      <Section title="3. Send">
        {block('session_collab_send', {
          credential: CRED_A,
          content: [
            '## ping-1',
            'Please acknowledge and continue.',
            '',
            '- Extra context line 3',
            '- Extra context line 4',
          ].join('\n'),
        }, {
          result: JSON.stringify({
            status: 'sent',
            to: { name: 'Alice', role: 'Reviewer', title: 'Alice - Reviewer', sessionId: 'child-alice' },
            peerSessionId: 'child-alice',
          }),
        })}
      </Section>
      <Section title="4. Retrieve (after wake) — N Messages Retrieved">
        {block('session_collab_retrieve', { credentials: [CRED_A, CRED_B] }, {
          result: JSON.stringify({
            status: 'messages',
            peers: [
              { name: 'Alice', role: 'Reviewer', title: 'Alice - Reviewer' },
              { name: 'Bob', role: 'Implementer', title: 'Bob - Implementer' },
            ],
            messages: [
              { content: '**alpha-pong-1** — review queued.', from: { name: 'Alice', role: 'Reviewer', title: 'Alice - Reviewer' } },
              { content: '**beta-pong-1** — implementer ready.', from: { name: 'Bob', role: 'Implementer', title: 'Bob - Implementer' } },
            ],
          }),
        })}
      </Section>
    </StoryShell>
  ),
}
