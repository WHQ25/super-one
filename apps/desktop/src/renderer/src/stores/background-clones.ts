import { create } from 'zustand'
import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { formatAddProjectError } from '@superone/shared/add-project-flow'

export interface ClonedProjectResult {
  projectId: string
  path: string
  name: string
  lastActiveAt?: number
  reused?: boolean
}

export interface BackgroundCloneTask {
  cloneId: string
  connectionId: string
  remoteUrl: string
  parentPath: string
  directoryName: string
  destinationPath: string
  progress: number | null
  backgrounded: boolean
}

export interface StartCloneInput {
  connectionId: string
  remoteUrl: string
  parentPath: string
  directoryName: string
  destinationPath: string
  shallow: boolean
  onBeforeSuccess?: (project: ClonedProjectResult) => Promise<void> | void
  onForegroundSuccess: (project: ClonedProjectResult) => void
  onForegroundError: (err: unknown) => void
}

interface BackgroundCloneStore {
  tasks: BackgroundCloneTask[]
  startClone: (input: StartCloneInput) => string
  moveToBackground: (cloneId: string) => void
  setProgress: (cloneId: string | undefined, percent: number) => void
  removeTask: (cloneId: string) => void
}

let unsubProgress: (() => void) | null = null

function ensureProgressSubscription(): void {
  if (unsubProgress) return
  if (typeof window === 'undefined' || !window.environment?.onCloneProgress) return
  unsubProgress = window.environment.onCloneProgress((event) => {
    useBackgroundCloneStore.getState().setProgress(event.cloneId, event.percent)
  })
}

function releaseProgressSubscriptionIfIdle(): void {
  if (useBackgroundCloneStore.getState().tasks.length > 0) return
  if (unsubProgress) {
    unsubProgress()
    unsubProgress = null
  }
}

function generateCloneId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `clone-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const useBackgroundCloneStore = create<BackgroundCloneStore>((set, get) => ({
  tasks: [],

  setProgress: (cloneId, percent) => {
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (cloneId && task.cloneId !== cloneId) return task
        if (!cloneId && state.tasks.length > 1) return task
        return { ...task, progress: percent }
      }),
    }))
  },

  removeTask: (cloneId) => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.cloneId !== cloneId),
    }))
    releaseProgressSubscriptionIfIdle()
  },

  moveToBackground: (cloneId) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.cloneId === cloneId ? { ...task, backgrounded: true } : task,
      ),
    }))
  },

  startClone: (input) => {
    const cloneId = generateCloneId()
    const task: BackgroundCloneTask = {
      cloneId,
      connectionId: input.connectionId,
      remoteUrl: input.remoteUrl,
      parentPath: input.parentPath,
      directoryName: input.directoryName,
      destinationPath: input.destinationPath,
      progress: null,
      backgrounded: false,
    }
    set((state) => ({ tasks: [task, ...state.tasks] }))
    ensureProgressSubscription()

    void window.environment
      .cloneRepository(input.connectionId, {
        remoteUrl: input.remoteUrl,
        parentPath: input.parentPath,
        directoryName: input.directoryName,
        shallow: input.shallow,
        ifExists: 'reuse',
        cloneId,
      })
      .then(async (project) => {
        try {
          await input.onBeforeSuccess?.(project)
        } finally {
          const current = get().tasks.find((t) => t.cloneId === cloneId)
          get().removeTask(cloneId)
          if (current?.backgrounded) {
            if (input.connectionId === 'local') {
              void import('@/stores/app').then(({ useAppStore }) => {
                if (typeof window.app?.getRecentFolders === 'function') {
                  void useAppStore.getState().fetchRecentFolders().catch(() => {})
                }
              })
            } else {
              void import('@/lib/host-projects-bus').then(({ notifyHostProjectsChanged }) => {
                notifyHostProjectsChanged()
              })
            }
            toast.success(i18n.t('sidebar.addProject.cloneCompleted', { name: project.name }))
          } else {
            input.onForegroundSuccess(project)
          }
        }
      })
      .catch((err) => {
        const current = get().tasks.find((t) => t.cloneId === cloneId)
        get().removeTask(cloneId)
        if (current?.backgrounded) {
          toast.error(
            i18n.t('sidebar.addProject.cloneFailed', {
              name: input.directoryName,
              error: formatAddProjectError(err, i18n.t),
            }),
          )
        } else {
          input.onForegroundError(err)
        }
      })

    return cloneId
  },
}))
