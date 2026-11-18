import type { StorageApplyAction, StorageCategory, StorageCategoryId, StorageInventory } from '@superone/shared/desktop-storage'

export const STORAGE_SECTIONS = [
  { id: 'database', ids: ['chat-database', 'backup', 'recovery-leftovers'] },
  { id: 'browser', ids: ['browser-http-cache', 'browser-code-cache', 'browser-site-data'] },
  { id: 'node', ids: ['node-event-log'] },
  { id: 'sync', ids: ['sync-attachments', 'sync-media'] },
  { id: 'cache', ids: ['app-cache', 'logs'] },
  { id: 'runtimes', ids: ['harness-runtimes'] },
] as const satisfies readonly { id: string; ids: readonly StorageCategoryId[] }[]

export type StorageSectionId = (typeof STORAGE_SECTIONS)[number]['id']

export const SECTION_BAR_CLASS: Record<StorageSectionId, string> = {
  database: 'bg-chart-1',
  browser: 'bg-chart-2',
  node: 'bg-chart-3',
  sync: 'bg-chart-4',
  cache: 'bg-chart-5',
  runtimes: 'bg-foreground/55',
}

export const SECTION_STRIPE_COLOR: Record<StorageSectionId, string> = {
  database: 'var(--chart-1)',
  browser: 'var(--chart-2)',
  node: 'var(--chart-3)',
  sync: 'var(--chart-4)',
  cache: 'var(--chart-5)',
  runtimes: 'color-mix(in oklab, var(--foreground) 55%, transparent)',
}

const OPTIMIZE_STEPS: readonly { id: StorageCategoryId; action: StorageApplyAction }[] = [
  { id: 'browser-http-cache', action: 'clear-browser-http-cache' },
  { id: 'browser-code-cache', action: 'clear-browser-code-cache' },
  { id: 'app-cache', action: 'clear-app-cache' },
  { id: 'backup', action: 'delete-backups' },
  { id: 'recovery-leftovers', action: 'delete-leftovers' },
  { id: 'sync-attachments', action: 'reclaim-sync-zone' },
  { id: 'sync-media', action: 'reclaim-sync-zone' },
  { id: 'harness-runtimes', action: 'clear-unused-harness-runtimes' },
  { id: 'node-event-log', action: 'compact-node-events' },
]

export function storageTotalBytes(inventory: StorageInventory): number {
  return inventory.categories.reduce((sum, category) => sum + Math.max(0, category.bytes), 0)
}

export function sectionBytes(inventory: StorageInventory): { id: StorageSectionId; bytes: number }[] {
  return STORAGE_SECTIONS.map((section) => ({
    id: section.id,
    bytes: section.ids.reduce((sum, id) => sum + Math.max(0, categoryById(inventory, id)?.bytes ?? 0), 0),
  }))
}

export function categoryOptimizableBytes(category: StorageCategory): number {
  const step = OPTIMIZE_STEPS.find((item) => item.id === category.id)
  if (!step || step.action === 'compact-node-events') return 0
  return deletableBytes(category, step.action)
}

export function rowOptimizableBytes(category: StorageCategory): number {
  return categoryOptimizableBytes(category)
}

export function reclaimableBytes(inventory: StorageInventory): number {
  return inventory.categories.reduce((sum, category) => sum + categoryOptimizableBytes(category), 0)
}

export function sectionDisplayedOptimizable(inventory: StorageInventory, id: StorageSectionId): number {
  return sectionOptimizableBytes(inventory, id)
}

export function sectionOptimizableBytes(inventory: StorageInventory, id: StorageSectionId): number {
  const section = STORAGE_SECTIONS.find((item) => item.id === id)
  if (!section) return 0
  return section.ids.reduce((sum, categoryId) => {
    const category = categoryById(inventory, categoryId)
    return sum + (category ? categoryOptimizableBytes(category) : 0)
  }, 0)
}

export function optimizePlan(inventory: StorageInventory): StorageApplyAction[] {
  const plan: StorageApplyAction[] = []
  for (const step of OPTIMIZE_STEPS) {
    const category = categoryById(inventory, step.id)
    if (!category) continue
    if (step.action === 'compact-node-events') {
      if (category.bytes > 0 || (inventory.nodeEvents?.rows ?? 0) > 0) plan.push(step.action)
      continue
    }
    if (deletableBytes(category, step.action) > 0 && !plan.includes(step.action)) plan.push(step.action)
  }
  return plan
}

export function sectionOf(id: StorageCategoryId): StorageSectionId {
  return STORAGE_SECTIONS.find((section) => (section.ids as readonly StorageCategoryId[]).includes(id))?.id ?? 'database'
}

function categoryById(inventory: StorageInventory, id: StorageCategoryId): StorageCategory | undefined {
  return inventory.categories.find((category) => category.id === id)
}

function deletableBytes(category: StorageCategory, action: StorageApplyAction): number {
  if (action === 'clear-unused-harness-runtimes' || action === 'trim-extra-backups' || action === 'reclaim-sync-zone') {
    return Math.max(0, category.unusedBytes ?? 0)
  }
  if (action === 'clear-app-cache') return Math.max(0, category.unusedBytes ?? category.bytes)
  return Math.max(0, category.bytes)
}
