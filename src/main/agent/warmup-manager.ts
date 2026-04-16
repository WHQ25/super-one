import { startup, type Options, type WarmQuery } from '@anthropic-ai/claude-agent-sdk'
import log from '../logger'
import { trace } from './event-trace'

interface WarmupSlot {
  key: string
  warm: WarmQuery
  createdAt: number
}

const STALE_TTL_MS = 5 * 60 * 1000

export class WarmupManager {
  private slot: WarmupSlot | null = null
  private inflightKey: string | null = null
  private disposed = false

  static keyOf(opts: Options): string {
    const envEntries = opts.env
      ? Object.entries(opts.env).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
      : []
    return JSON.stringify({
      cwd: opts.cwd ?? '',
      effort: opts.effort ?? '',
      permissionMode: opts.permissionMode ?? 'default',
      bypass: opts.allowDangerouslySkipPermissions ?? false,
      sandbox: opts.sandbox ? `${!!opts.sandbox.enabled}|${!!opts.sandbox.autoAllowBashIfSandboxed}` : '',
      additionalDirectories: [...(opts.additionalDirectories ?? [])].sort(),
      env: envEntries,
      cli: opts.pathToClaudeCodeExecutable ?? '',
    })
  }

  prewarm(options: Options): void {
    if (this.disposed) return
    const key = WarmupManager.keyOf(options)

    if (this.slot && this.slot.key === key) {
      const age = Date.now() - this.slot.createdAt
      if (age < STALE_TTL_MS) return
      log.info('[warmup] discarding stale slot (age=%dms) and re-warming', age)
      this.discardSlot('stale')
    }

    if (this.inflightKey === key) return

    if (this.slot && this.slot.key !== key) this.discardSlot('key_changed')
    if (this.inflightKey && this.inflightKey !== key) {
      log.info('[warmup] superseding inflight (key changed)')
    }

    this.inflightKey = key
    log.info('[warmup] startup() begin key=%s', shortKey(key))
    const t0 = Date.now()
    startup({ options }).then((warm) => {
      const dur = Date.now() - t0
      if (this.disposed || this.inflightKey !== key) {
        log.info('[warmup] startup() resolved but superseded (durMs=%d)', dur)
        warm.close()
        return
      }
      this.slot = { key, warm, createdAt: Date.now() }
      this.inflightKey = null
      log.info('[warmup] startup() ready durMs=%d key=%s', dur, shortKey(key))
      trace('warmup', 'ready', { key, durMs: dur })
    }).catch((err) => {
      if (this.inflightKey === key) this.inflightKey = null
      log.warn('[warmup] startup() failed: %s', err instanceof Error ? err.message : String(err))
      trace('warmup', 'error', { key, error: String(err) })
    })
  }

  consume(options: Options): WarmQuery | null {
    if (this.disposed) return null
    const key = WarmupManager.keyOf(options)
    if (!this.slot || this.slot.key !== key) {
      trace('warmup', 'miss', { key, hasSlot: !!this.slot, slotKey: this.slot?.key })
      return null
    }
    const age = Date.now() - this.slot.createdAt
    if (age > STALE_TTL_MS) {
      log.info('[warmup] consume found stale slot (age=%dms), discarding', age)
      this.discardSlot('stale_on_consume')
      return null
    }
    const warm = this.slot.warm
    log.info('[warmup] HIT — consumed slot ageMs=%d key=%s', age, shortKey(key))
    trace('warmup', 'hit', { key, ageMs: age })
    this.slot = null
    return warm
  }

  private discardSlot(reason: string): void {
    if (!this.slot) return
    log.info('[warmup] discard slot reason=%s key=%s', reason, shortKey(this.slot.key))
    try { this.slot.warm.close() } catch { /* ignore */ }
    this.slot = null
  }

  dispose(): void {
    this.disposed = true
    this.discardSlot('dispose')
    this.inflightKey = null
  }
}

function shortKey(key: string): string {
  return key.length > 80 ? `${key.slice(0, 80)}…` : key
}
