import type { SwarmBoardMember, SwarmBoardMessage, SwarmBoardSnapshot } from '@superone/shared/swarm-board-types'

export interface MemberPalette {
  bg: string
  text: string
  border: string
  dot: string
  hex: string
}

const WORKER_PALETTES: MemberPalette[] = [
  { bg: 'bg-purple-500/15', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/30', dot: 'bg-purple-500', hex: '#a855f7' },
  { bg: 'bg-blue-500/15', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-500', hex: '#3b82f6' },
  { bg: 'bg-cyan-500/15', text: 'text-cyan-600 dark:text-cyan-400', border: 'border-cyan-500/30', dot: 'bg-cyan-500', hex: '#06b6d4' },
  { bg: 'bg-teal-500/15', text: 'text-teal-600 dark:text-teal-400', border: 'border-teal-500/30', dot: 'bg-teal-500', hex: '#14b8a6' },
  { bg: 'bg-green-500/15', text: 'text-green-600 dark:text-green-400', border: 'border-green-500/30', dot: 'bg-green-500', hex: '#22c55e' },
  { bg: 'bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/30', dot: 'bg-amber-500', hex: '#f59e0b' },
  { bg: 'bg-orange-500/15', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/30', dot: 'bg-orange-500', hex: '#f97316' },
  { bg: 'bg-rose-500/15', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/30', dot: 'bg-rose-500', hex: '#f43f5e' },
]

const COORDINATOR_PALETTE: MemberPalette = {
  bg: 'bg-amber-500/15',
  text: 'text-amber-600 dark:text-amber-400',
  border: 'border-amber-500/40',
  dot: 'bg-amber-500',
  hex: '#f59e0b',
}

export function getMemberPalette(name: string, colorIndex?: number): MemberPalette {
  if (name === 'coordinator') return COORDINATOR_PALETTE
  if (typeof colorIndex === 'number' && Number.isFinite(colorIndex)) {
    return WORKER_PALETTES[((colorIndex % WORKER_PALETTES.length) + WORKER_PALETTES.length) % WORKER_PALETTES.length]!
  }
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return WORKER_PALETTES[Math.abs(hash) % WORKER_PALETTES.length]!
}

export function isTaskDoneForMember(
  name: string,
  messages: SwarmBoardMessage[],
  membersByName: Map<string, SwarmBoardMember>,
): boolean {
  for (const msg of messages) {
    if (msg.agent === name && msg.isDone) return true
  }
  const member = membersByName.get(name)
  if (!member) return false
  if (name === 'monitor' && messages.some((m) => m.agent === 'coordinator' && m.isDone)) {
    return true
  }
  return false
}

export interface ThreadProgress {
  id: string
  title: string
  goal?: string
  tasks: string[]
  doneCount: number
  totalCount: number
  isDone: boolean
}

export function computeSwarmProgress(snapshot: SwarmBoardSnapshot): {
  doneTasks: number
  totalTasks: number
  threads: ThreadProgress[]
} {
  const membersByName = new Map(snapshot.members.map((m) => [m.name, m]))
  const planThreads = snapshot.plan?.threads ?? []
  const taskEntries = Object.keys(snapshot.plan?.tasks ?? {})

  if (planThreads.length > 0) {
    let doneTasks = 0
    let totalTasks = 0
    const threads: ThreadProgress[] = planThreads.map((t) => {
      const uniqueTasks = Array.from(new Set(t.tasks))
      const doneCount = uniqueTasks.filter((name) =>
        isTaskDoneForMember(name, snapshot.messages, membersByName),
      ).length
      const totalCount = uniqueTasks.length
      doneTasks += doneCount
      totalTasks += totalCount
      return {
        id: t.id,
        title: t.title,
        goal: t.goal,
        tasks: uniqueTasks,
        doneCount,
        totalCount,
        isDone: totalCount > 0 && doneCount >= totalCount,
      }
    })
    return { doneTasks, totalTasks, threads }
  }

  const workers = taskEntries.length > 0
    ? taskEntries
    : snapshot.members.filter((m) => m.role === 'worker').map((m) => m.name)
  const doneTasks = workers.filter((name) =>
    isTaskDoneForMember(name, snapshot.messages, membersByName),
  ).length
  return { doneTasks, totalTasks: workers.length, threads: [] }
}

export function formatBoardDuration(messages: SwarmBoardMessage[]): string {
  if (messages.length < 2) return '0s'
  const parseTime = (t?: string): number | null => {
    if (!t) return null
    const ms = Date.parse(t.includes('T') ? t : t.replace(' ', 'T'))
    return Number.isFinite(ms) ? ms : null
  }
  const first = parseTime(messages[0]?.time)
  const last = parseTime(messages[messages.length - 1]?.time)
  if (first === null || last === null || last < first) return '0s'
  const totalSec = Math.round((last - first) / 1000)
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}
