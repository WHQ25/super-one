import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ComposerSwitch } from './ComposerSwitch'
import { COMPOSER_IDS, type ComposerId } from './composer-slot/resolve-composer'

function ComposerSwitchPreview() {
  const [kind, setKind] = useState<ComposerId>('text')
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-4 flex flex-wrap gap-2">
        {COMPOSER_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setKind(id)}
            className="rounded border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
          >
            {id}
          </button>
        ))}
      </div>
      <ComposerSwitch
        kind={kind}
        align={{ kind: 'voice', to: 'text' }}
        maxHeight={kind === 'decision' ? 'min(45vh, 440px)' : undefined}
        render={(id) => (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-sm font-medium">{id} composer</div>
            <div className="mt-2 text-xs text-muted-foreground">Use the buttons above to hand off between slot entries.</div>
          </div>
        )}
      />
    </div>
  )
}

const meta = {
  title: 'Chat/ComposerSwitch',
  component: ComposerSwitchPreview,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ComposerSwitchPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Handoff: Story = {}
