import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { PluginNoticeRow, PluginStatusLines } from './PluginNotice'

function Section({ title, note, children, width = 640 }: { title: string; note?: string; children: ReactNode; width?: number }) {
  return (
    <section className="space-y-1.5" style={{ width }}>
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {note && <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>}
      {children}
    </section>
  )
}

/** Stands in for the composer the status lines sit above. */
function Composer() {
  return (
    <div className="mx-3 mb-1 flex min-h-9 items-center rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground/60">
      Ask anything…
    </div>
  )
}

const LONG_LINE = 'context 71% full · 3 compactions avoided · forecast: the next large file read will push the conversation past the auto-compact threshold, consider /compact now'

const meta: Meta = {
  title: 'Chat/PluginNotice',
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj

/** Transcript rows: a mod's `$.ui.log` line, and a plugin that failed to load. */
export const TranscriptRows: Story = {
  render: () => (
    <div className="space-y-6">
      <Section title="Log line">
        <PluginNoticeRow meta={{ plugin: 'blast-radius' }} text="held `rm -rf dist` until you confirm" />
      </Section>
      <Section title="Load error" note="From system/init plugin_errors.">
        <PluginNoticeRow meta={{ plugin: 'token-weather@acme-internal', level: 'error' }} text="hooks/hooks.json: modules[0] ./register.js was not found" />
      </Section>
      <Section title="Long content" note="Truncates to one line; the full text is in the tooltip.">
        <PluginNoticeRow meta={{ plugin: 'token-weather' }} text={LONG_LINE} />
      </Section>
      <Section title="Narrow" width={280}>
        <PluginNoticeRow meta={{ plugin: 'replay-theater' }} text="recorded 4 edits — run /replay to step through them" />
      </Section>
    </div>
  ),
}

/** Pinned `$.ui.status` lines above the composer, one per plugin; none renders nothing. */
export const ComposerStatus: Story = {
  render: () => (
    <div className="space-y-6">
      <Section title="One plugin">
        <PluginStatusLines statuses={{ 'token-weather': 'context 42% · clear skies' }} />
        <Composer />
      </Section>
      <Section title="Several plugins, long content">
        <PluginStatusLines statuses={{ 'token-weather': LONG_LINE, 'blast-radius': 'guarding 2 paths' }} />
        <Composer />
      </Section>
      <Section title="Empty" note="No plugin has a status: the slot takes no space.">
        <PluginStatusLines statuses={{}} />
        <Composer />
      </Section>
      <Section title="Narrow" width={300}>
        <PluginStatusLines statuses={{ 'token-weather': 'context 42% · clear skies' }} />
        <Composer />
      </Section>
    </div>
  ),
}
