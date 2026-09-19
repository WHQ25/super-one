import { useLayoutEffect } from 'react'
import type { JevRunAction, JevRunPlatform } from '@superone/shared/agent-types'
import {
  createDefaultPerSessionState,
  createDefaultProjectState,
  useChatStore,
} from '@/stores/chat'

/** The project and session the Storybook decorator sets up for every story. */
export const SB_PROJECT = '__storybook__'
export const SB_SESSION = 'sb'

/** Seeds what a run has reported so far, the way the loop's host events would. */
export function seedRun(
  platform: JevRunPlatform,
  runId: string,
  actions: JevRunAction[],
  opts: { active?: boolean } = {},
): void {
  const session = createDefaultPerSessionState()
  session.jevRuns = { [runId]: { platform, actions } }
  session._activeJevRunId = opts.active === false ? null : runId
  const project = createDefaultProjectState()
  project._activeSessionId = SB_SESSION
  project._sessions = { [SB_SESSION]: session }
  useChatStore.setState({
    activeProject: SB_PROJECT,
    projectSessions: { [SB_PROJECT]: project },
  })
}

/**
 * Seeds store state before the blocks below it read it. Writing during render
 * leaves the first commit reading the previous snapshot, so the seeded run
 * never reaches the block.
 */
export function RunSeed({ seed }: { seed: () => void }): null {
  useLayoutEffect(seed, [seed])
  return null
}
