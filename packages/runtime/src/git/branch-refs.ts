import { sanitizeGitRef } from './sanitize-ref'

/** Local branch names for one checkout. `error` is set when the list could not be read. */
export interface LocalBranchList {
  local: string[]
  error?: string
}

export function localBranchNames(raw: string): string[] {
  return raw.split('\n').map((line) => line.trim()).filter(Boolean)
}

/**
 * Local names from a `git branch` string list, an IPC `{ local }` payload, or
 * a node `{ branches }` payload. An `error` string is kept so a failed read is
 * not shown as an empty repository.
 */
export function localBranchList(value: unknown): LocalBranchList {
  if (Array.isArray(value)) {
    return { local: value.filter((item): item is string => typeof item === 'string') }
  }
  if (!value || typeof value !== 'object') return { local: [] }
  const record = value as { local?: unknown; branches?: unknown; error?: unknown }
  const names = (list: unknown) => Array.isArray(list)
    ? list.filter((item): item is string => typeof item === 'string')
    : []
  const local = Array.isArray(record.local) ? names(record.local) : names(record.branches)
  const error = typeof record.error === 'string' && record.error ? record.error : undefined
  return error ? { local, error } : { local }
}

/** `git branch` names through a caller-supplied runner. Desktop IPC and the node share this. */
export async function readLocalBranchNames(git: (args: string[]) => Promise<string>): Promise<string[]> {
  return localBranchNames(await git(['branch', '--format=%(refname:short)']))
}

/** Checkout an existing local branch. The ref is sanitized before it reaches git. */
export async function checkoutExistingBranch(git: (args: string[]) => Promise<string>, branch: string): Promise<void> {
  await git(['checkout', sanitizeGitRef(branch)])
}
