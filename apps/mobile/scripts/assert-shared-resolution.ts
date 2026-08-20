#!/usr/bin/env bun
/**
 * WP-04: bun workspace + shared exports resolve without Node-only leaves.
 * Metro uses the same export map (`unstable_enablePackageExports`).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import { applySeqToMessage } from '@superone/shared/event-seq-utils'
import type { RemoteCommand } from '@superone/shared/agent-types'

const ALLOWED = [
  'agent-types',
  'event-seq-utils',
  'agent-event-batcher',
  'content-delta',
  'tool-ui',
  'agent-error',
  'harness-brand',
] as const

const FORBIDDEN = ['attachment-store', 'git-clone'] as const

const sharedPkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../packages/shared/package.json'), 'utf8'),
) as { exports: Record<string, unknown> }

if (AGENT_EVENT_BATCH_MS !== 33) {
  throw new Error(`AGENT_EVENT_BATCH_MS drifted: ${AGENT_EVENT_BATCH_MS}`)
}

const stamped = applySeqToMessage({ type: 'status_change', status: 'idle', seq: 1, epoch: 2 } as never)
if (stamped._lastAppliedSeq !== 1 || stamped._lastAppliedEpoch !== 2) {
  throw new Error('event-seq-utils failed to stamp seq')
}

const _cmd: RemoteCommand = { type: 'interrupt', sessionId: 's' }
void _cmd

for (const leaf of ALLOWED) {
  const key = `./${leaf}`
  if (!(key in sharedPkg.exports) && !('./ *' in sharedPkg.exports) && !('./*' in sharedPkg.exports)) {
    throw new Error(`missing shared export ${key}`)
  }
}

if (!('./*' in sharedPkg.exports)) {
  throw new Error('shared package lost the ./* source export map Metro needs')
}

for (const leaf of FORBIDDEN) {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), `../../../packages/shared/src/${leaf}.ts`),
    'utf8',
  )
  if (!src.includes('node:')) {
    throw new Error(`${leaf} was expected to stay Node-only; Metro blockList may be stale`)
  }
}

console.log('ok: @superone/shared leaf imports resolve; Node-only leaves stay blocked')
