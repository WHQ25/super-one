import type { SubagentColorClasses } from './SubagentBlock'

export const SUBAGENT_COLOR_POOL = ['purple', 'blue', 'cyan', 'teal', 'green', 'amber', 'orange', 'rose'] as const
export type SubagentColor = (typeof SUBAGENT_COLOR_POOL)[number]

export const SUBAGENT_COLOR_CLASSES: Record<SubagentColor, SubagentColorClasses> = {
  purple: {
    text: 'text-purple-600 dark:text-purple-400',
    tagBg: 'bg-purple-500/15 dark:bg-purple-900/40',
    tagText: 'text-purple-700 dark:text-purple-300',
    activityBg: 'bg-purple-500/10 dark:bg-purple-900/20',
    borderL: 'border-purple-500/30',
  },
  blue: {
    text: 'text-blue-600 dark:text-blue-400',
    tagBg: 'bg-blue-500/15 dark:bg-blue-900/40',
    tagText: 'text-blue-700 dark:text-blue-300',
    activityBg: 'bg-blue-500/10 dark:bg-blue-900/20',
    borderL: 'border-blue-500/30',
  },
  cyan: {
    text: 'text-cyan-600 dark:text-cyan-400',
    tagBg: 'bg-cyan-500/15 dark:bg-cyan-900/40',
    tagText: 'text-cyan-700 dark:text-cyan-300',
    activityBg: 'bg-cyan-500/10 dark:bg-cyan-900/20',
    borderL: 'border-cyan-500/30',
  },
  teal: {
    text: 'text-teal-600 dark:text-teal-400',
    tagBg: 'bg-teal-500/15 dark:bg-teal-900/40',
    tagText: 'text-teal-700 dark:text-teal-300',
    activityBg: 'bg-teal-500/10 dark:bg-teal-900/20',
    borderL: 'border-teal-500/30',
  },
  green: {
    text: 'text-green-600 dark:text-green-400',
    tagBg: 'bg-green-500/15 dark:bg-green-900/40',
    tagText: 'text-green-700 dark:text-green-300',
    activityBg: 'bg-green-500/10 dark:bg-green-900/20',
    borderL: 'border-green-500/30',
  },
  amber: {
    text: 'text-amber-600 dark:text-amber-400',
    tagBg: 'bg-amber-500/15 dark:bg-amber-900/40',
    tagText: 'text-amber-700 dark:text-amber-300',
    activityBg: 'bg-amber-500/10 dark:bg-amber-900/20',
    borderL: 'border-amber-500/30',
  },
  orange: {
    text: 'text-orange-600 dark:text-orange-400',
    tagBg: 'bg-orange-500/15 dark:bg-orange-900/40',
    tagText: 'text-orange-700 dark:text-orange-300',
    activityBg: 'bg-orange-500/10 dark:bg-orange-900/20',
    borderL: 'border-orange-500/30',
  },
  rose: {
    text: 'text-rose-600 dark:text-rose-400',
    tagBg: 'bg-rose-500/15 dark:bg-rose-900/40',
    tagText: 'text-rose-700 dark:text-rose-300',
    activityBg: 'bg-rose-500/10 dark:bg-rose-900/20',
    borderL: 'border-rose-500/30',
  },
}

export const DEFAULT_SUBAGENT_COLOR_CLASSES = SUBAGENT_COLOR_CLASSES.purple

export function getSubagentColorClasses(idx: number | undefined): SubagentColorClasses {
  if (idx === undefined) return DEFAULT_SUBAGENT_COLOR_CLASSES
  const name = SUBAGENT_COLOR_POOL[idx % SUBAGENT_COLOR_POOL.length]
  return SUBAGENT_COLOR_CLASSES[name] ?? DEFAULT_SUBAGENT_COLOR_CLASSES
}

/**
 * Draw the next colour the way the desktop store does: a random pick from the
 * unused part of the pool, refilled once every colour has been handed out, so
 * neighbouring cards never share a colour until the pool runs dry.
 */
export function createSubagentColorPicker(random: () => number = Math.random) {
  const assigned = new Map<string, number>()
  let free: number[] = []
  return (toolUseId: string): number => {
    const existing = assigned.get(toolUseId)
    if (existing !== undefined) return existing
    if (free.length === 0) free = SUBAGENT_COLOR_POOL.map((_, index) => index)
    const pick = Math.min(free.length - 1, Math.floor(random() * free.length))
    const [index] = free.splice(pick, 1)
    assigned.set(toolUseId, index!)
    return index!
  }
}

/**
 * The phone shows one session per WebView and, like the desktop, keeps colours
 * only for the life of the view — a reload redraws them.
 */
export const portableSubagentColorIndex = createSubagentColorPicker()
