import { SUBAGENT_COLOR_POOL } from '@/stores/chat'

export interface SubagentColorClasses {
  text: string
  tagBg: string
  tagText: string
  activityBg: string
  borderL: string
}

export const SUBAGENT_COLOR_CLASSES: Record<string, SubagentColorClasses> = {
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
