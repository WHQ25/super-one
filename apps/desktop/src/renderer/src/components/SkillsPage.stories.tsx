/**
 * Storybook: Settings → Harnesses → Skills tab. Skill listing, file reads and
 * the enable toggle are mocked, so rows expand into the file browser offline.
 */
import type { ReactElement } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { SkillDetail, SkillInfo } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { SkillsPage } from './SkillsPage'

const skill = (overrides: Partial<SkillInfo> & Pick<SkillInfo, 'name'>): SkillInfo => ({
  displayName: overrides.name,
  scope: 'user',
  description: '',
  hasConfig: false,
  sourcePath: `/Users/demo/.claude/skills/${overrides.name}/SKILL.md`,
  ...overrides,
})

const SKILLS: SkillInfo[] = [
  skill({ name: 'pdf', description: 'Read, merge, split and fill PDF files.' }),
  skill({ name: 'release', description: 'Release desktop builds or mobile OTA updates using the repository workflows.' }),
  skill({ name: 'code-review:review', displayName: 'review', description: 'Provided by the code-review plugin.', sourcePath: '/Users/demo/.claude/plugins/code-review/skills/review/SKILL.md' }),
  skill({ name: 'frontend-design', description: 'Guidance for distinctive, intentional visual design.' }),
  skill({ name: 'deploy', scope: 'project', description: 'Project deploy checklist.', sourcePath: '/Users/demo/projects/superone/.claude/skills/deploy/SKILL.md' }),
]

const LONG_TEXT = 'Use this skill whenever the user wants to create, read, edit, or manipulate spreadsheets, including cleaning messy tabular data, computing formulas, formatting cells, charting, converting between CSV/TSV/XLSX formats, and restructuring malformed rows and headers.'

const LONG_SKILLS: SkillInfo[] = Array.from({ length: 14 }, (_, i) => skill({
  name: `enterprise-spreadsheet-automation-and-reporting-skill-${i + 1}`,
  description: LONG_TEXT,
  sourcePath: `/Users/demo/Library/Application Support/SuperOne/very/deeply/nested/skills/directory/enterprise-spreadsheet-${i + 1}/SKILL.md`,
}))

const detailFor = (s: SkillInfo): SkillDetail => ({
  ...s,
  files: [
    { name: 'SKILL.md', isDirectory: false },
    { name: 'scripts', isDirectory: true, children: [{ name: 'run.py', isDirectory: false }] },
    { name: 'reference.md', isDirectory: false },
  ],
})

const SKILL_MD = `---
name: pdf
description: Read, merge, split and fill PDF files.
---

# PDF

Use \`pypdf\` for merging and splitting.
`

function seed(skills: SkillInfo[], { provider = 'claude', disabled = [] }: { provider?: 'claude' | 'codex'; disabled?: string[] } = {}) {
  return (Story: () => ReactElement) => {
    let disabledSkills = [...disabled]
    let codexSkills = skills
    mockIpc('app', 'listSkills', async () => skills)
    mockIpc('app', 'codexListSkills', async () => codexSkills)
    const read = async (_pp: unknown, name: unknown) => detailFor(skills.find((s) => s.name === name) ?? skills[0])
    mockIpc('app', 'readSkill', read)
    mockIpc('app', 'codexReadSkill', read)
    mockIpc('app', 'readSkillFile', async () => SKILL_MD)
    mockIpc('app', 'codexReadSkillFile', async () => SKILL_MD)
    mockIpc('app', 'toggleSkill', async (name: unknown, off: unknown) => {
      disabledSkills = off ? [...disabledSkills, String(name)] : disabledSkills.filter((n) => n !== name)
      return disabledSkills
    })
    mockIpc('app', 'codexToggleSkill', async (_pp: unknown, ref: unknown, enabled: unknown) => {
      const { name } = ref as { name: string }
      codexSkills = codexSkills.map((s) => (s.name === name ? { ...s, enabled: Boolean(enabled) } : s))
    })
    mockIpc('app', 'selectFolder', async () => null)
    mockIpc('app', 'deleteSkill', async () => undefined)
    useAppStore.setState({ settingsProvider: provider, currentFolder: '/Users/demo/projects/superone' })
    useSettingsStore.setState({ skills: [], skillDetail: null, skillFileContent: null, skillFilePath: null, disabledSkills })
    return <Story />
  }
}

const meta: Meta<typeof SkillsPage> = {
  title: 'Settings/Harnesses/Skills',
  component: SkillsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    // Mirrors the Harnesses detail column, which owns the padding.
    (Story) => (
      <div className="min-h-[720px] bg-background px-7 pt-5 pb-8 text-foreground">
        <div className="mx-auto max-w-3xl">
          <Story />
        </div>
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof SkillsPage>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

export const Populated: Story = {
  decorators: [seed(SKILLS, { disabled: ['frontend-design'] })],
  play: async ({ canvasElement }) => {
    await expect(await body(canvasElement).findByText('release')).toBeInTheDocument()
  },
}

/** Clicking a row opens the file tree + preview inside the card. */
export const Expanded: Story = {
  decorators: [seed(SKILLS)],
  play: async ({ canvasElement }) => {
    const screen = body(canvasElement)
    await userEvent.click(await screen.findByText('pdf'))
    await expect(await screen.findByText('reference.md')).toBeInTheDocument()
  },
}

export const Codex: Story = {
  decorators: [seed(SKILLS.map((s, i) => ({ ...s, enabled: i !== 1, builtin: i === 3 })), { provider: 'codex' })],
}

export const Empty: Story = {
  decorators: [seed([])],
}

export const LongContent: Story = {
  decorators: [seed(LONG_SKILLS)],
}

export const Narrow: Story = {
  decorators: [
    seed(SKILLS),
    (Story) => (
      <div className="max-w-[420px]">
        <Story />
      </div>
    ),
  ],
}
