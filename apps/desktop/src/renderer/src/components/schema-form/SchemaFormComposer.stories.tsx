import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { parseSchemaForm, type SchemaFormValue } from '@superone/shared/schema-form'
import { SchemaFormComposer } from './SchemaFormComposer'

function swatch(color: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}"/><text x="32" y="38" font-family="sans-serif" font-size="14" fill="white" text-anchor="middle">${label}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const PARTS = [
  { const: 'hex-bolt', title: 'M6 hex bolt', description: 'Fastener for the main joint.', 'x-openai-thumbnail': { src: swatch('#0ea5e9', 'M6') } },
  { const: 'washer', title: 'M6 washer', 'x-openai-thumbnail': { src: swatch('#f97316', 'W') } },
  { const: 'bracket', title: 'L-bracket, 40 mm', 'x-openai-thumbnail': { src: swatch('#22c55e', 'L') } },
  // No thumbnail: renders the fallback image, as the spec requires.
  { const: 'spacer', title: 'Nylon spacer' },
]

const RESOURCES = [
  {
    uri: 'cad://parts/hex-bolt', name: 'hex-bolt.stl', title: 'M6 hex bolt', mimeType: 'model/stl', size: 48_213,
    _meta: { 'openai/thumbnail': { src: swatch('#0ea5e9', 'M6') } },
  },
  { uri: 'cad://parts/washer', name: 'washer.step', title: 'M6 washer', mimeType: 'model/step', size: 9_120 },
  { uri: 'cad://parts/bracket', name: 'bracket.stl', description: 'Revision C, approved for production.' },
]

function Shell({ children, width = 560 }: { children: ReactNode; width?: number }) {
  return <div className="@container rounded-lg border border-border bg-card p-3" style={{ maxWidth: width }}>{children}</div>
}

/** Production composer around a raw `requestedSchema`, echoing what it would send. */
function Composer({ schema, requester = 'Bits & Bolts', allowAlways }: { schema: unknown; requester?: string; allowAlways?: boolean }) {
  const [sent, setSent] = useState<string | null>(null)
  const reply = (text: string) => setSent(text)
  return (
    <div className="flex flex-col gap-2">
      <SchemaFormComposer
        form={parseSchemaForm(schema)}
        requester={requester}
        allowAlways={allowAlways}
        onSubmit={(content: Record<string, SchemaFormValue>, always) => reply(JSON.stringify({ action: 'accept', always, content }, null, 2))}
        onDecline={() => reply('{ "action": "decline" }')}
        onCancel={() => reply('{ "action": "cancel" }')}
      />
      {sent && <pre data-testid="sent" className="overflow-x-auto rounded bg-muted p-2 text-[11px] text-muted-foreground">{sent}</pre>}
    </div>
  )
}

const meta: Meta<typeof Composer> = {
  title: 'Tool UI/General/Permission Prompt/Schema Form',
  component: Composer,
  parameters: { layout: 'padded' },
  decorators: [(Story, ctx) => <Shell width={ctx.parameters.shellWidth}><Story /></Shell>],
}

export default meta
type Story = StoryObj<typeof Composer>

const ALL_KINDS = {
  type: 'object',
  required: ['name', 'environment', 'replicas'],
  properties: {
    name: { type: 'string', title: 'Release name', description: 'Shown in the deploy log.', minLength: 3, maxLength: 40 },
    email: { type: 'string', title: 'Notify', format: 'email' },
    date: { type: 'string', title: 'Window opens', format: 'date' },
    reference: { type: 'string', title: 'CAD or file URI', format: 'uri', pattern: '^(cad|file):' },
    replicas: { type: 'integer', title: 'Replicas', minimum: 1, maximum: 12, default: 2 },
    tolerance: { type: 'number', title: 'Tolerance (mm)', minimum: 0, maximum: 10 },
    approved: { type: 'boolean', title: 'Approved', description: 'Skip the second review.' },
    environment: {
      type: 'string', title: 'Environment',
      oneOf: [
        { const: 'staging', title: 'Staging', description: 'Mirrors production data nightly.' },
        { const: 'production', title: 'Production', description: 'Customer traffic.' },
      ],
    },
    region: { type: 'string', title: 'Region', enum: ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-northeast-1'] },
    checks: { type: 'array', title: 'Checks', items: { anyOf: [{ const: 'lint', title: 'Lint' }, { const: 'unit', title: 'Unit tests' }, { const: 'e2e', title: 'End-to-end' }] }, default: ['lint'] },
    tags: { type: 'array', title: 'Tags', uniqueItems: true, items: { type: 'string', 'x-openai-suggestions': [{ const: 'hotfix', title: 'Hotfix' }, { const: 'canary', title: 'Canary' }] } },
    part: { type: 'string', title: 'Reference part', format: 'uri', 'x-openai-input': { type: 'resource', options: RESOURCES.slice(0, 2) } },
  },
}

export const AllInputKinds: Story = { args: { schema: ALL_KINDS, allowAlways: true } }

/** `cad.pickFile`: titled options with `x-openai-thumbnail` render as an image grid. */
export const Thumbnails: Story = {
  args: { schema: { type: 'object', required: ['part'], properties: { part: { type: 'string', title: 'CAD part', oneOf: PARTS } } } },
}

/** Suggested values on a string and on a string array; free text stays allowed. */
export const Suggestions: Story = {
  args: {
    schema: {
      type: 'object',
      properties: {
        part: { type: 'string', title: 'Part', minLength: 1, 'x-openai-suggestions': [{ const: 'hex-bolt', title: 'M6 hex bolt' }, { const: 'washer', title: 'M6 washer' }] },
        accessories: { type: 'array', title: 'Accessories', items: { type: 'string', 'x-openai-suggestions': [{ const: 'washer', title: 'M6 washer', 'x-openai-thumbnail': { src: swatch('#f97316', 'W') } }, { const: 'nut', title: 'M6 nut' }] }, default: ['washer', 'custom-spacer'] },
      },
    },
  },
}

/** `cad.pickReferences` single and explicit selection; `userOptions` are not offered. */
export const ResourcePicker: Story = {
  args: {
    schema: {
      type: 'object',
      required: ['primary', 'references'],
      properties: {
        primary: { type: 'string', title: 'Primary part', format: 'uri', 'x-openai-input': { type: 'resource', options: RESOURCES }, default: 'cad://parts/hex-bolt' },
        references: {
          type: 'array', title: 'CAD references', items: { type: 'string', format: 'uri' }, minItems: 1,
          'x-openai-input': { type: 'resource', selection: 'explicit', options: RESOURCES, userOptions: { kind: 'file', accept: ['.stl', '.step'] } },
          default: ['cad://parts/washer'],
        },
        empty: { type: 'string', title: 'Optional library', format: 'uri', 'x-openai-input': { type: 'resource', options: [] } },
      },
    },
  },
}

/** Submitting with invalid answers reveals every error and sends nothing. */
export const ValidationErrors: Story = {
  args: { schema: ALL_KINDS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/Release name/), 'ab')
    await userEvent.type(canvas.getByLabelText(/CAD or file URI/), 'https://example.com/part')
    await userEvent.click(canvas.getByRole('button', { name: 'Submit' }))
    await expect(canvas.getByText('Use at least 3 characters')).toBeInTheDocument()
    await expect(canvas.getByText("Doesn't match the expected format")).toBeInTheDocument()
    await expect(canvas.getAllByText('Required').length).toBeGreaterThan(0)
    await expect(canvas.queryByTestId('sent')).toBeNull()
  },
}

/** A form with any input SuperOne cannot render is reported, never partially shown. */
export const Unsupported: Story = {
  args: {
    schema: {
      type: 'object',
      properties: {
        note: { type: 'string', title: 'Note' },
        parts: { type: 'array', items: { type: 'string', format: 'uri' }, 'x-openai-input': { type: 'resource', selection: 'implicit', options: RESOURCES } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText('Note')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }))
    await expect(canvas.getByTestId('sent')).toHaveTextContent('cancel')
  },
}

const LONG = 'A deliberately long label that keeps going to check wrapping in narrow composers without overflowing the card edge'

export const LongContent: Story = {
  args: {
    requester: 'An MCP server with an unusually long display name',
    schema: {
      type: 'object',
      required: ['choice'],
      properties: {
        ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`field${i}`, { type: 'string', title: `${LONG} #${i + 1}`, description: LONG }])),
        choice: { type: 'string', title: LONG, oneOf: PARTS.map((p) => ({ ...p, title: `${p.title} — ${LONG}`, description: LONG })) },
        refs: { type: 'array', title: LONG, items: { type: 'string', format: 'uri' }, 'x-openai-input': { type: 'resource', options: RESOURCES.map((r) => ({ ...r, title: `${r.name} ${LONG}` })) } },
      },
    },
  },
}

export const Narrow: Story = {
  args: AllInputKinds.args,
  parameters: { shellWidth: 300 },
}

export const ThumbnailsNarrow: Story = {
  args: Thumbnails.args,
  parameters: { shellWidth: 300 },
}

export const DarkChinese: Story = {
  args: AllInputKinds.args,
  globals: { theme: 'dark', locale: 'zh' },
}

export const UnsupportedDark: Story = {
  args: Unsupported.args,
  globals: { theme: 'dark' },
}
