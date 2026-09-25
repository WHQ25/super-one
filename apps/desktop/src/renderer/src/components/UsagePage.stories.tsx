import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import i18n from 'i18next'
import { expect, userEvent, within } from 'storybook/test'
import type { CatalogModel, ModelCatalog } from '@superone/shared/model-catalog-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { UsagePage } from './UsagePage'

type Harness = 'claude' | 'codex' | 'grok'
interface Row {
  day: string
  harness: Harness
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
}

const model = (providerId: string, id: string, name: string, cost?: CatalogModel['cost']): CatalogModel => ({
  id, name, providerId, cost, inputModalities: ['text'], outputModalities: ['text'], reasoning: true, toolCall: true, attachment: false,
})

const CATALOG: ModelCatalog = {
  generatedAt: '2026-09-24T00:00:00.000Z',
  source: 'cache',
  providers: [
    { id: 'anthropic', name: 'Anthropic', env: [], npm: '@ai-sdk/anthropic', doc: '', models: [
      model('anthropic', 'claude-sonnet-4-5', 'Claude Sonnet 4.5', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }),
      model('anthropic', 'claude-opus-4-1', 'Claude Opus 4.1', { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }),
    ] },
    { id: 'openai', name: 'OpenAI', env: [], npm: '@ai-sdk/openai', doc: '', models: [
      model('openai', 'gpt-5-codex', 'GPT-5-Codex', { input: 1.25, output: 10, cacheRead: 0.125 }),
    ] },
  ],
}

function localDay(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Deterministic history: ~120 days, heavier on weekdays, three harnesses and one unpriced model. */
function buildRows(days: number): Row[] {
  const rows: Row[] = []
  const models: Array<[Harness, string, number]> = [
    ['claude', 'claude-sonnet-4-5', 1],
    ['claude', 'claude-opus-4-1', 0.25],
    ['codex', 'gpt-5-codex', 0.6],
    ['grok', 'grok-code-fast-1', 0.3],
  ]
  for (let offset = 0; offset < days; offset++) {
    const weekday = new Date(Date.now() - offset * 86_400_000).getDay()
    const load = (weekday === 0 || weekday === 6 ? 0.3 : 1) * (1 + ((offset * 37) % 11) / 10)
    if (offset % 13 === 5) continue // idle days so the heatmap shows gaps
    for (const [harness, id, share] of models) {
      const base = Math.round(180_000 * load * share)
      rows.push({
        day: localDay(offset),
        harness,
        model: id,
        input_tokens: base,
        output_tokens: Math.round(base * 0.35),
        cache_read_tokens: base * 6,
        cache_creation_tokens: Math.round(base * 0.8),
      })
    }
  }
  return rows
}

let rows: Row[] = []
let pending = false
let backfilling = false

mockIpc('app', 'getModelCatalog', async () => CATALOG)
mockIpc('app', 'queryUsage', (range: unknown) => {
  if (pending) return new Promise(() => {})
  const { from, to } = (range ?? {}) as { from?: string; to?: string }
  return Promise.resolve({ rows: rows.filter((r) => (!from || r.day >= from) && (!to || r.day <= to)) })
})
mockIpc('app', 'queryUsageCounts', (range: unknown) => {
  if (pending) return new Promise(() => {})
  const { from } = (range ?? {}) as { from?: string }
  const days = new Set(rows.filter((r) => !from || r.day >= from).map((r) => r.day)).size
  return Promise.resolve({ sessions: days * 7, messages: days * 164 })
})
mockIpc('app', 'getUsageBackfillStatus', async () => (backfilling ? 'pending' : 'done'))

/** The page queries on mount, so a story seeds the mocks during render — before that effect runs. */
function seed(opts: { days?: number; pending?: boolean; backfilling?: boolean }) {
  return (Story: () => ReactElement) => {
    rows = buildRows(opts.days ?? 0)
    pending = opts.pending ?? false
    backfilling = opts.backfilling ?? false
    return <Story />
  }
}

const meta: Meta<typeof UsagePage> = {
  title: 'Settings/Usage',
  component: UsagePage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="h-[900px] overflow-y-auto bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof UsagePage>

const preset = (id: string) => i18n.t(`settings.usage.presets.${id}`)

/** Waiting on the first query: tiles read zero and the chart card shows a spinner. */
export const Loading: Story = { decorators: [seed({ pending: true })] }

/** No recorded usage in range. */
export const Empty: Story = { decorators: [seed({})] }

/** Today: the chart breaks tokens down per model; the grok model has no list price. */
export const Populated: Story = { decorators: [seed({ days: 120 })] }

/** Last 7 days: daily bars by harness with totals on top. */
export const LastSevenDays: Story = {
  decorators: [seed({ days: 120 })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('tab', { name: preset('7d') }))
    await expect(canvas.getByRole('tab', { name: preset('7d') })).toHaveAttribute('aria-selected', 'true')
  },
}

/** A single harness switches the chart to a token-type breakdown. */
export const FilteredByHarness: Story = {
  decorators: [seed({ days: 120 })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('tab', { name: preset('30d') }))
    await userEvent.click(canvas.getByRole('tab', { name: i18n.t('settings.usage.harness.codex') }))
  },
}

/** All time: contribution heatmap. */
export const AllTimeHeatmap: Story = {
  decorators: [seed({ days: 120 })],
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('tab', { name: preset('all') }))
  },
}

/** Historical backfill still running: status sits next to the range switcher. */
export const Backfilling: Story = { decorators: [seed({ days: 3, backfilling: true })] }

/** Settings pane squeezed by a narrow window: tiles go two-up and the table scrolls sideways. */
export const Narrow: Story = {
  decorators: [seed({ days: 120 }), (Story) => <div className="w-[560px]"><Story /></div>],
}
