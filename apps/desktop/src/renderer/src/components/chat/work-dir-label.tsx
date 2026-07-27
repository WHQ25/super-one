import type { ComponentType } from 'react'
import { GitBranch, GitCommit, Monitor } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'

/**
 * Every way SuperOne can describe where a session runs. `active*` is a worktree that already
 * exists; the rest are worktrees that will be created when the session starts. This is the
 * single source for the status-bar chip (`WorkDirIndicator`) and for prompts that preview a
 * session before it exists (`SessionAgentsConfirmPrompt`) — keep them speaking one language.
 */
export type WorkDirState =
  | { kind: 'local' }
  | { kind: 'activeBranch'; name: string }
  | { kind: 'activeDetached'; hash: string }
  | { kind: 'createBranch'; name: string }
  | { kind: 'attachTo'; base: string }
  | { kind: 'createFrom'; base: string }

/** Detached HEAD is a commit, everything else on a worktree is a branch, no worktree is local. */
export function workDirIcon(state: WorkDirState): ComponentType<{ className?: string }> {
  if (state.kind === 'local') return Monitor
  if (state.kind === 'activeDetached' || state.kind === 'createFrom') return GitCommit
  return GitBranch
}

export function workDirTitle(state: WorkDirState, t: (key: string) => string): string {
  switch (state.kind) {
    case 'activeDetached': return `Worktree ${state.hash}`
    case 'activeBranch': return `Worktree ${state.name}`
    case 'createFrom': return `Create worktree from ${state.base}`
    case 'attachTo': return `Attach worktree to ${state.base}`
    case 'createBranch': return `Create worktree branch ${state.name || '…'}`
    case 'local': return t('tooltips.local')
  }
}

const inlineBranch = <GitBranch className="inline size-3 align-middle" />
const inlineCommit = <GitCommit className="inline size-3 align-middle" />

/** The full inline label — icon rendered inside the sentence, exactly as the status bar shows it. */
export function WorkDirLabel({ state }: { state: WorkDirState }) {
  const { t } = useTranslation()
  switch (state.kind) {
    case 'activeDetached':
      return <Trans i18nKey="chat.worktree.triggerActiveDetached" values={{ hash: state.hash }} components={{ commit: inlineCommit }} />
    case 'activeBranch':
      return <Trans i18nKey="chat.worktree.triggerActiveBranch" values={{ name: state.name }} components={{ branch: inlineBranch }} />
    case 'createFrom':
      return <Trans i18nKey="chat.worktree.triggerCreateFrom" values={{ base: state.base }} components={{ branch: inlineBranch }} />
    case 'attachTo':
      return <Trans i18nKey="chat.worktree.triggerAttachTo" values={{ base: state.base }} components={{ branch: inlineBranch }} />
    case 'createBranch':
      return <Trans i18nKey="chat.worktree.triggerCreateBranch" values={{ name: state.name || '…' }} components={{ branch: inlineBranch }} />
    case 'local':
      return (
        <>
          <Monitor className="inline size-3 align-middle" />
          <span className="ml-1">{t('tooltips.local')}</span>
        </>
      )
  }
}
