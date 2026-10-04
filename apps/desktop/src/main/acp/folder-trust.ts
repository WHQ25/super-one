export interface FolderTrustRequest {
  sessionId: string
  cwd: string
  workspace: string
  configKinds: string[]
}

export function parseFolderTrustRequest(raw: unknown): FolderTrustRequest {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const text = (...keys: string[]) => {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'string') return value
    }
    return ''
  }
  const kindsRaw = record.configKinds ?? record.config_kinds
  const configKinds = Array.isArray(kindsRaw)
    ? kindsRaw.filter((item): item is string => typeof item === 'string')
    : []
  return {
    sessionId: text('sessionId', 'session_id'),
    cwd: text('cwd'),
    workspace: text('workspace'),
    configKinds,
  }
}

/** Trust only on an explicit allow. Cancel, deny, and any other decision reject. */
export function folderTrustDecision(allow: boolean, decision?: 'cancel'): 'trust' | 'reject' {
  return allow && decision !== 'cancel' ? 'trust' : 'reject'
}

/**
 * Answer `x.ai/folder_trust/request`. Anything other than the exact string
 * `trust`, including a throw or a timeout, is `reject`.
 */
export async function settleFolderTrust(
  ask: () => Promise<unknown>,
  timeoutMs: number,
): Promise<{ outcome: 'trust' | 'reject' }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      ask(),
      new Promise<'reject'>((resolve) => {
        timer = setTimeout(() => resolve('reject'), timeoutMs)
      }),
    ])
    return { outcome: result === 'trust' ? 'trust' : 'reject' }
  } catch {
    return { outcome: 'reject' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
