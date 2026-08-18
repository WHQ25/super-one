import type { Meta, StoryObj } from '@storybook/react-vite'
import type { AgentErrorInfo } from '@superone/shared/agent-types'
import { Clock } from 'lucide-react'
import { MessageErrorBadge } from './MessageErrorBadge'

/**
 * Every sample is a real SDK failure shape: the fields are exactly what
 * `claude-query` pulls off `assistant.error`, `system/api_retry` and the
 * error-subtype result message.
 */
const SAMPLES: Array<{ note: string; info: AgentErrorInfo }> = [
  {
    note: 'OAuth credential rejected',
    info: {
      raw: 'OAuth token has expired or been revoked',
      code: 'authentication_failed',
      httpStatus: 401,
      terminalReason: 'api_error',
      subtype: 'error_during_execution',
      model: 'claude-opus-5',
      requestId: 'req_011CRvB8xK2mNq',
    },
  },
  {
    note: 'Org policy blocks the account',
    info: {
      raw: 'This organization does not allow access to the requested model',
      code: 'oauth_org_not_allowed',
      httpStatus: 403,
      terminalReason: 'api_error',
    },
  },
  {
    note: 'No credit left',
    info: { raw: 'Credit balance is too low', code: 'billing_error', httpStatus: 402, terminalReason: 'api_error' },
  },
  {
    note: 'Rate limited',
    info: { raw: 'Number of requests has exceeded your rate limit', code: 'rate_limit', httpStatus: 429 },
  },
  {
    note: 'Upstream overloaded after three retries',
    info: {
      raw: 'API Error: 529 {"type":"overloaded_error","message":"Overloaded"}',
      code: 'overloaded',
      httpStatus: 529,
      terminalReason: 'api_error',
      subtype: 'error_during_execution',
      model: 'claude-opus-5',
      retries: { attempts: 3, delaysMs: [2000, 4000, 8000], max: 3 },
    },
  },
  {
    note: 'Model missing on this provider',
    info: { raw: 'model: claude-opus-5 not found', code: 'model_not_found', httpStatus: 404 },
  },
  {
    note: 'Upstream 5xx',
    info: { raw: 'Internal server error', code: 'server_error', httpStatus: 500, requestId: 'req_011CRvC91Lp' },
  },
  {
    note: 'Context window exceeded — terminal_reason beats the vague code',
    info: {
      raw: 'input length and max_tokens exceed context limit: 231402 + 32000 > 200000',
      code: 'invalid_request',
      httpStatus: 400,
      terminalReason: 'prompt_too_long',
      model: 'claude-opus-5',
    },
  },
  {
    note: 'Attachment rejected',
    info: { raw: 'Could not process image', code: 'invalid_request', httpStatus: 400, terminalReason: 'image_error' },
  },
  {
    note: 'Output truncated',
    info: { raw: 'Response exceeded max_tokens', code: 'max_output_tokens' },
  },
  {
    note: 'Step ceiling hit — mapped from the result subtype alone',
    info: { raw: 'Reached maximum number of turns', subtype: 'error_max_turns', terminalReason: 'max_turns' },
  },
  {
    note: 'Task budget spent',
    info: { raw: 'Budget exhausted', subtype: 'error_max_budget_usd', terminalReason: 'budget_exhausted' },
  },
  {
    note: 'Tool-call format never recovered',
    info: { raw: 'Malformed tool use retries exhausted', terminalReason: 'malformed_tool_use_exhausted' },
  },
  {
    note: 'Codex — attempts counted, no backoff delays on the wire',
    info: { raw: 'stream error: connection reset', retries: { attempts: 2 } },
  },
  {
    note: 'Generic 400',
    info: { raw: 'messages.3: unexpected role "system"', code: 'invalid_request', httpStatus: 400 },
  },
  {
    note: 'Unmapped — details open by default, raw text leads',
    info: { raw: 'spawn /usr/local/bin/claude ENOENT' },
  },
]

/** Mimics the real turn footer so the badge is seen in the density it ships at. */
function FooterRow({ info, note }: { info: AgentErrorInfo; note: string }) {
  return (
    <div className="border-b py-3 last:border-b-0">
      <p className="mb-1.5 text-xs text-muted-foreground/60">{note}</p>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3" />
        <span>4s</span>
        <span>·</span>
        <MessageErrorBadge info={info} />
      </div>
    </div>
  )
}

const meta = {
  title: 'Chat/MessageErrorBadge',
  component: MessageErrorBadge,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof MessageErrorBadge>

export default meta
type Story = StoryObj<typeof meta>

/** Every mapped failure kind. Click any badge to read its popover. */
export const AllKinds: Story = {
  args: { info: SAMPLES[0]!.info },
  render: () => (
    <div className="max-w-2xl">
      {SAMPLES.map((sample) => (
        <FooterRow key={sample.note} info={sample.info} note={sample.note} />
      ))}
    </div>
  ),
}

/** The default state a user sees: one badge, nothing else. */
export const SingleFailure: Story = {
  args: { info: SAMPLES[0]!.info },
  render: (args) => (
    <div className="max-w-2xl">
      <FooterRow info={args.info} note="Turn failed" />
    </div>
  ),
}

/** Retry ladder — the one detail the old footer could never show. */
export const WithRetryLadder: Story = {
  args: { info: SAMPLES[4]!.info },
  render: (args) => (
    <div className="max-w-2xl">
      <FooterRow info={args.info} note="Three retries burned before giving up" />
    </div>
  ),
}

/** Nothing mapped: the badge degrades to "request failed" and leads with raw text. */
export const UnmappedFallback: Story = {
  args: { info: SAMPLES[15]!.info },
  render: (args) => (
    <div className="max-w-2xl">
      <FooterRow info={args.info} note="No typed code, no terminal reason, no status" />
    </div>
  ),
}

/** A harness that sends only a plain string — the reducer's synthesized shape. */
export const RawStringOnly: Story = {
  args: { info: { raw: 'Codex run failed: stream closed unexpectedly' } },
  render: (args) => (
    <div className="max-w-2xl">
      <FooterRow info={args.info} note="Codex / ACP / Cursor path" />
    </div>
  ),
}
