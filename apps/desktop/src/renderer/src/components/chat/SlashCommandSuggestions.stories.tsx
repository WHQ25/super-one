import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import type { SlashCommandInfo } from '@superone/shared/agent-types'
import { matchAndRankSlashCommands } from '@superone/shared/slash-command-match'
import { SlashCommandSuggestions } from './SlashCommandSuggestions'

const skill: SlashCommandInfo = {
  name: 'skill-creator',
  description: 'Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch or optimize an existing skill.',
  argumentHint: '<skill-name> [--evaluate]',
  isSkill: true,
}
const catalog: SlashCommandInfo[] = [
  skill,
  { ...skill },
  { name: 'release', description: 'Release SuperOne', argumentHint: '', isSkill: true },
  { name: 'shadcn', description: 'Compose UI components', argumentHint: '', isSkill: true },
  { name: 'compact', description: 'Compact context', argumentHint: '', isSkill: false },
]

function Preview({ distinct = false, narrow = false, initialQuery = '/' }: {
  distinct?: boolean
  narrow?: boolean
  initialQuery?: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const commands = matchAndRankSlashCommands(query.slice(1), distinct
    ? [...catalog, { ...skill, description: 'Create or update a Codex skill with appropriately scoped instructions.' }]
    : catalog)

  return (
    <div data-testid="slash-command-preview" className="space-y-2 text-foreground" style={{ width: narrow ? 300 : 560 }}>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1.5">
        <SlashCommandSuggestions
          commands={commands}
          selectedIndex={selectedIndex}
          onSelect={(command) => setQuery(`/${command.name} `)}
        />
      </div>
      <input
        aria-label="Slash command query"
        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
        value={query}
        onInput={(event) => { setQuery(event.currentTarget.value); setSelectedIndex(0) }}
        onKeyDown={(event) => {
          if (!commands.length) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const delta = event.key === 'ArrowDown' ? 1 : -1
            setSelectedIndex((index) => (index + delta + commands.length) % commands.length)
          }
          if (event.key === 'Enter') setQuery(`/${commands[selectedIndex].name} `)
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Chat/SlashCommandSuggestions',
  component: SlashCommandSuggestions,
  args: { commands: [], selectedIndex: 0, onSelect: () => {} },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof SlashCommandSuggestions>
export default meta
type Story = StoryObj<typeof meta>

export const DuplicateSkills: Story = {
  render: () => <Preview />,
  play: async ({ canvasElement }) => {
    const preview = within(canvasElement).getByTestId('slash-command-preview')
    const canvas = within(preview)
    const input = canvas.getByRole('textbox', { name: 'Slash command query' })
    await userEvent.type(input, 'skill-c')
    await expect(canvas.getAllByRole('button')).toHaveLength(1)
    await expect(preview.querySelector('.text-highlighted')).toHaveTextContent('/skill-c')
  },
}

export const SameNameDifferentDescriptions: Story = {
  render: () => <Preview distinct />,
  play: async ({ canvasElement }) => {
    const canvas = within(within(canvasElement).getByTestId('slash-command-preview'))
    await userEvent.type(canvas.getByRole('textbox'), 'skill-c')
    await expect(canvas.getAllByRole('button')).toHaveLength(2)
    for (const row of canvas.getAllByRole('button')) {
      await expect(row.querySelector('.text-highlighted')).toHaveTextContent('/skill-c')
    }
  },
}

export const NarrowLongContent: Story = { render: () => <Preview distinct narrow initialQuery="/skill-c" /> }
export const Empty: Story = { render: () => <Preview initialQuery="/no-match" /> }
