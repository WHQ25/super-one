import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container space-y-2" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

const meta: Meta = {
  title: 'Tool UI/General/Ask User Question',
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj

export const MarkdownPreview: Story = {
  name: 'Answered · Markdown preview',
  render: () => (
    <ToolBlock
      toolName="AskUserQuestion"
      status="complete"
      input={JSON.stringify({
        questions: [
          {
            question: 'Which pricing layout do you prefer?',
            header: 'Pricing layout',
            multiSelect: false,
            options: [
              { label: 'Three-column', description: 'Classic side-by-side tiers', preview: '## Three-column\n\n| Tier | Price |\n| --- | --- |\n| Free | $0 |\n| Pro | $19 |\n| Team | $49 |' },
              { label: 'Single-card', description: 'One card with a toggle', preview: '## Single-card\n\nA single pricing card with a monthly/yearly toggle.' },
            ],
          },
        ],
        answers: { 'Which pricing layout do you prefer?': 'Three-column' },
        annotations: {
          'Which pricing layout do you prefer?': {
            preview: '## Three-column\n\n| Tier | Price |\n| --- | --- |\n| Free | $0 |\n| Pro | $19 |\n| Team | $49 |',
            notes: 'Keep the Team tier highlighted',
          },
        },
        previewFormat: 'markdown',
      })}
      result={'"Which pricing layout do you prefer?"="Three-column"'}
    />
  ),
}

export const HtmlPreview: Story = {
  name: 'Answered · HTML preview',
  render: () => (
    <ToolBlock
      toolName="AskUserQuestion"
      status="complete"
      input={JSON.stringify({
        questions: [
          {
            question: 'Which hero style do you like?',
            header: 'Hero style',
            multiSelect: false,
            options: [
              {
                label: 'Bold gradient',
                description: 'High-contrast gradient background',
                preview: '<div style="padding:24px;border-radius:8px;background:linear-gradient(135deg,#f97316,#ec4899);color:white;font-family:sans-serif"><h2 style="margin:0 0 8px">Ship faster</h2><p style="margin:0">A bold gradient hero section.</p></div>',
              },
              {
                label: 'Minimal',
                description: 'Plain background, large type',
                preview: '<div style="padding:24px;font-family:sans-serif"><h2 style="margin:0 0 8px">Ship faster</h2><p style="margin:0;color:#666">A minimal, quiet hero section.</p></div>',
              },
            ],
          },
        ],
        answers: { 'Which hero style do you like?': 'Bold gradient' },
        annotations: {
          'Which hero style do you like?': {
            preview: '<div style="padding:24px;border-radius:8px;background:linear-gradient(135deg,#f97316,#ec4899);color:white;font-family:sans-serif"><h2 style="margin:0 0 8px">Ship faster</h2><p style="margin:0">A bold gradient hero section.</p></div>',
          },
        },
        previewFormat: 'html',
      })}
      result={'"Which hero style do you like?"="Bold gradient"'}
    />
  ),
}

/** Older sessions recorded before annotations.preview existed — falls back to plain Q&A text. */
export const LegacyWithoutPreview: Story = {
  name: 'Answered · legacy without preview',
  render: () => (
    <ToolBlock
      toolName="AskUserQuestion"
      status="complete"
      input={JSON.stringify({
        questions: [{ question: 'Continue with the migration?', header: 'Migration', multiSelect: false, options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }] }],
        answers: { 'Continue with the migration?': 'Yes' },
      })}
      result={'"Continue with the migration?"="Yes"'}
    />
  ),
}
