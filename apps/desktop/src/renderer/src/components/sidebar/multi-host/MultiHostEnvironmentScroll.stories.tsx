import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { projectRef } from '@superone/shared/environment'
import type { PinnedSessionEntry, SessionHistoryEntry } from '@superone/shared/agent-types'
import type { EnvironmentBucket, HostCheckout, SidebarSort } from '@/lib/multi-host/types'
import { MultiHostEnvironmentScroll } from './MultiHostEnvironmentScroll'

function makeCheckout(
  environmentId: string,
  connectionId: string,
  projectId: string,
  name: string,
): HostCheckout {
  const hostPath = connectionId === 'local' ? `/Users/dev/${name}` : `/srv/${name}`
  const pathKey = connectionId === 'local' ? hostPath : `remote:${connectionId}:${hostPath}`
  return {
    ref: projectRef(environmentId, projectId),
    environmentId,
    connectionId,
    projectId,
    name,
    pathKey,
    hostPath,
    repoIdentity: `git:https://github.com/acme/${name}.git`,
    addedAt: 1,
    lastOpened: 2,
  }
}

function makeBucket(
  environmentId: string,
  connectionId: string,
  label: string,
  checkouts: HostCheckout[],
  connection: EnvironmentBucket['connection'] = 'connected',
): EnvironmentBucket {
  return {
    environmentId,
    connectionId,
    label,
    kind: connectionId === 'local' ? 'local' : 'cli-node',
    connection,
    projectsStatus: connection === 'offline' ? 'idle' : 'ready',
    projectsError: null,
    checkouts,
  }
}

function makeSessions(prefix: string, titles: string[], parentIndex?: number): SessionHistoryEntry[] {
  const entries = titles.map((title, index): SessionHistoryEntry => ({
    sessionId: `${prefix}-s-${index}`,
    title,
    lastActiveAt: '2026-11-12T05:40:00.000Z',
    messageCount: index + 2,
    provider: 'claude',
    ...(parentIndex === index ? { childCount: 2 } : {}),
  }))
  if (parentIndex != null && entries[parentIndex]) {
    const parentId = entries[parentIndex]!.sessionId
    entries.push(
      {
        sessionId: `${parentId}-child-1`,
        parentSessionId: parentId,
        title: 'Verify multi-host scroll heights',
        lastActiveAt: '2026-11-12T05:41:00.000Z',
        messageCount: 3,
        provider: 'claude',
      },
      {
        sessionId: `${parentId}-child-2`,
        parentSessionId: parentId,
        title: 'Check transition timing under reduced motion',
        lastActiveAt: '2026-11-12T05:42:00.000Z',
        messageCount: 2,
        provider: 'claude',
      },
    )
  }
  return entries
}

function makeSettled(checkout: HostCheckout, count: number): PinnedSessionEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `${checkout.projectId}-settled-${index}`,
    title: `Archived task #${index + 1} in ${checkout.name}`,
    lastActiveAt: '2026-11-10T00:00:00.000Z',
    messageCount: 4,
    provider: 'claude',
    folderPath: checkout.pathKey,
    folderName: checkout.name,
    isSettled: true,
  }))
}

const macCheckouts = [
  makeCheckout('mac', 'local', 'mac-super-one', 'super-one'),
  makeCheckout('mac', 'local', 'mac-browser-use', 'browser-use'),
  makeCheckout('mac', 'local', 'mac-devspace', 'devspace'),
  makeCheckout('mac', 'local', 'mac-openusage', 'openusage'),
  makeCheckout('mac', 'local', 'mac-rea', 'rea'),
  makeCheckout('mac', 'local', 'mac-openui', 'openui'),
  makeCheckout('mac', 'local', 'mac-test-super-one', 'test-super-one'),
]

const vensenaSuperOne = makeCheckout('vensena', 'cli-vensena', 'ven-super-one', 'super-one')

const studioCheckouts = Array.from({ length: 9 }, (_, index) =>
  makeCheckout('studio', 'cli-studio', `studio-${index}`, `service-${index + 1}`),
)

const macSuperOneSessions = makeSessions(
  'mac-so',
  Array.from({ length: 12 }, (_, index) => `Sidebar layout refinement #${index + 1}`),
  0,
)

const openusageSessions = makeSessions(
  'mac-ou',
  Array.from({ length: 10 }, (_, index) => `Quota meter sync #${index + 1}`),
)

const browserUseSessions = makeSessions('mac-bu', [
  'Stabilize tab snapshot selector',
  'Reuse domain login memory',
  'Close temporary tabs on finish',
])

const devspaceSessions = makeSessions('mac-ds', [
  'Container port forwarding check',
  'Mount ssh agent socket',
])

const vensenaSessions = makeSessions('ven-so', ['调研远程节点 Harness 独立登录方案'])

interface HarnessProps {
  environments: EnvironmentBucket[]
  initialExpandedProjects: string[]
  initialCollapsedEnvironments?: string[]
  folderSessions: Record<string, SessionHistoryEntry[]>
  sessionsHasMore?: Record<string, boolean>
  settledSessions?: PinnedSessionEntry[]
  settledCounts?: Record<string, number>
  sidebarHeight: number
}

function InteractiveSpaceHarness({
  environments,
  initialExpandedProjects,
  initialCollapsedEnvironments = [],
  folderSessions,
  sessionsHasMore,
  settledSessions,
  settledCounts,
  sidebarHeight,
}: HarnessProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpandedProjects))
  const [collapsedEnvs, setCollapsedEnvs] = useState<string[]>(initialCollapsedEnvironments)
  const [sort, setSort] = useState<SidebarSort>('recent')
  const [activeSession, setActiveSession] = useState<{ folderPath: string; sessionId: string } | null>(null)

  const initialExpandedKey = initialExpandedProjects.join('|')
  const initialCollapsedKey = initialCollapsedEnvironments.join('|')

  useEffect(() => {
    setExpanded(new Set(initialExpandedProjects))
  }, [initialExpandedKey])

  useEffect(() => {
    setCollapsedEnvs(initialCollapsedEnvironments)
  }, [initialCollapsedKey])

  const toggleProject = (folderPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      return next
    })
  }

  const toggleEnvironment = (environmentId: string) => {
    setCollapsedEnvs((prev) =>
      prev.includes(environmentId)
        ? prev.filter((id) => id !== environmentId)
        : [...prev, environmentId],
    )
  }

  return (
    <div
      data-slot="sidebar-story-frame"
      style={{ height: sidebarHeight }}
      className="w-72 resize-y overflow-hidden rounded-md border border-border bg-sidebar text-sidebar-foreground shadow-sm"
    >
      <MultiHostEnvironmentScroll
        environments={environments}
        groupBy="environment"
        sort={sort}
        expandedProjectKeys={expanded}
        collapsedEnvironmentIds={collapsedEnvs}
        folderSessions={folderSessions}
        sessionsHasMore={sessionsHasMore}
        settledSessions={settledSessions}
        settledCounts={settledCounts}
        loadingFolders={{}}
        openingSession={activeSession}
        onToggleProject={toggleProject}
        onToggleEnvironment={toggleEnvironment}
        onSwitchSession={(folderPath, sessionId) => setActiveSession({ folderPath, sessionId })}
        onPinSession={() => {}}
        onSettleSession={() => {}}
        onRenameSession={() => {}}
        onDeleteSession={() => {}}
        onEditProject={() => {}}
        onRemoveProject={() => {}}
        onNewSession={() => {}}
        onRefreshEnvironment={() => {}}
        onToggleConnection={() => {}}
        onAddProject={() => {}}
        onSort={setSort}
        connectionBusyId={null}
        refreshingConnectionId={null}
      />
    </div>
  )
}

const meta = {
  title: 'Sidebar/MultiHostEnvironmentScroll',
  component: InteractiveSpaceHarness,
  argTypes: {
    sidebarHeight: {
      control: { type: 'range', min: 320, max: 960, step: 10 },
    },
  },
  args: {
    environments: [
      makeBucket('mac', 'local', '25s-MacBook-Pro.local', macCheckouts),
      makeBucket('vensena', 'cli-vensena', 'VensenA', [vensenaSuperOne]),
    ],
    initialExpandedProjects: [macCheckouts[0]!.pathKey, vensenaSuperOne.pathKey],
    initialCollapsedEnvironments: [],
    folderSessions: {
      [macCheckouts[0]!.pathKey]: macSuperOneSessions,
      [macCheckouts[1]!.pathKey]: browserUseSessions,
      [macCheckouts[2]!.pathKey]: devspaceSessions,
      [macCheckouts[3]!.pathKey]: openusageSessions,
      [vensenaSuperOne.pathKey]: vensenaSessions,
    },
    sessionsHasMore: {
      [macCheckouts[0]!.pathKey]: true,
      [vensenaSuperOne.pathKey]: true,
    },
    settledSessions: [
      ...makeSettled(macCheckouts[0]!, 6),
      ...makeSettled(vensenaSuperOne, 4),
    ],
    settledCounts: {
      [macCheckouts[0]!.pathKey]: 1049,
      [vensenaSuperOne.pathKey]: 69,
    },
    sidebarHeight: 680,
  },
} satisfies Meta<typeof InteractiveSpaceHarness>

export default meta
type Story = StoryObj<typeof meta>

export const ScreenshotScenario: Story = {
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const macViewport = canvasElement.querySelector<HTMLElement>(
      '[data-environment-id="mac"] [data-environment-project-list] [data-slot="scroll-area-viewport"]',
    )!
    const vensenaViewport = canvasElement.querySelector<HTMLElement>(
      '[data-environment-id="vensena"] [data-environment-project-list] [data-slot="scroll-area-viewport"]',
    )!
    await expect(vensenaViewport.clientHeight).toBeLessThan(140)
    await expect(macViewport.clientHeight).toBeGreaterThan(400)
  },
}

export const WaterFillingThreeHosts: Story = {
  args: {
    environments: [
      makeBucket('mac', 'local', '25s-MacBook-Pro.local', macCheckouts),
      makeBucket('studio', 'cli-studio', 'Studio-M2-Ultra', studioCheckouts),
      makeBucket('vensena', 'cli-vensena', 'VensenA', [vensenaSuperOne]),
    ],
    sidebarHeight: 960,
  },
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const macList = canvasElement.querySelector<HTMLElement>('[data-environment-id="mac"] [data-environment-project-list]')!
    const studioViewport = canvasElement.querySelector<HTMLElement>(
      '[data-environment-id="studio"] [data-environment-project-list] [data-slot="scroll-area-viewport"]',
    )!
    const vensenaViewport = canvasElement.querySelector<HTMLElement>(
      '[data-environment-id="vensena"] [data-environment-project-list] [data-slot="scroll-area-viewport"]',
    )!
    await expect(vensenaViewport.clientHeight).toBeLessThan(140)
    await expect(studioViewport.clientHeight).toBe(studioViewport.scrollHeight)
    await expect(Number.parseFloat(macList.style.maxHeight)).toBeGreaterThan(324)
  },
}

export const SiblingProjectsInOneHost: Story = {
  args: {
    initialExpandedProjects: [
      macCheckouts[0]!.pathKey,
      macCheckouts[1]!.pathKey,
      macCheckouts[3]!.pathKey,
      vensenaSuperOne.pathKey,
    ],
    sidebarHeight: 780,
  },
}

export const TightPaneCapped: Story = {
  args: {
    environments: [
      makeBucket('mac', 'local', '25s-MacBook-Pro.local', macCheckouts),
      makeBucket('studio', 'cli-studio', 'Studio-M2-Ultra', studioCheckouts),
      makeBucket('vensena', 'cli-vensena', 'VensenA', [vensenaSuperOne]),
    ],
    sidebarHeight: 420,
  },
}
