import { startup, type Options, type WarmQuery } from '@anthropic-ai/claude-agent-sdk'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import log from '../logger'
import { trace } from './event-trace'

function probeClaudeBinary(opts: Options): string {
  const parts: string[] = []
  parts.push(`optsCwd=${opts.cwd ?? '<none>'}`)
  parts.push(`optsPathToCli=${opts.pathToClaudeCodeExecutable ?? '<none>'}`)
  if (opts.pathToClaudeCodeExecutable) {
    const p = opts.pathToClaudeCodeExecutable
    const unpackedP = p.includes('/app.asar/') ? p.replace('/app.asar/', '/app.asar.unpacked/') : p
    try { parts.push(`pathExists=${existsSync(p)}`) } catch (e) { parts.push(`pathExists=err(${(e as Error).message})`) }
    if (unpackedP !== p) {
      try { parts.push(`unpackedExists=${existsSync(unpackedP)}`) } catch (e) { parts.push(`unpackedExists=err(${(e as Error).message})`) }
    }
  } else {
    try {
      const req = createRequire(import.meta.url)
      try {
        const sdkMain = req.resolve('@anthropic-ai/claude-agent-sdk')
        parts.push(`sdkMain=${sdkMain}`)
      } catch (e) {
        parts.push(`sdkMain=resolve FAILED: ${(e as Error).message}`)
      }
      const ext = process.platform === 'win32' ? '.exe' : ''
      const candidates = process.platform === 'linux'
        ? [`@anthropic-ai/claude-agent-sdk-linux-${process.arch}-musl/claude${ext}`, `@anthropic-ai/claude-agent-sdk-linux-${process.arch}/claude${ext}`]
        : [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude${ext}`]
      for (const c of candidates) {
        try {
          const p = req.resolve(c)
          const unpackedP = p.includes('/app.asar/') ? p.replace('/app.asar/', '/app.asar.unpacked/') : p
          const exists = (() => { try { return existsSync(p) } catch (e) { return `err(${(e as Error).message})` } })()
          const unpackedExists = unpackedP !== p ? (() => { try { return existsSync(unpackedP) } catch (e) { return `err(${(e as Error).message})` } })() : '(same)'
          parts.push(`native[${c}] -> ${p} (exists=${exists}, unpackedExists=${unpackedExists})`)
        } catch (e) {
          parts.push(`native[${c}] -> resolve FAILED: ${(e as Error).message}`)
        }
      }
    } catch (e) {
      parts.push(`probe-err=${(e as Error).message}`)
    }
  }
  return parts.join(' | ')
}

interface WarmupSlot {
  key: string
  warm: WarmQuery
  createdAt: number
  abortController: AbortController
  idleTimer: ReturnType<typeof setTimeout> | null
}

const STALE_TTL_MS = 10 * 60 * 1000

export class WarmupManager {
  private slot: WarmupSlot | null = null
  private inflightKey: string | null = null
  private disposed = false

  private startSlotIdleTimer(slot: WarmupSlot): void {
    slot.idleTimer = setTimeout(() => {
      if (this.slot === slot) {
        log.info('[warmup] idle timer fired, discarding slot key=%s ageMs=%d', shortKey(slot.key), Date.now() - slot.createdAt)
        this.discardSlot('idle_timeout')
      }
    }, STALE_TTL_MS)
  }

  static keyOf(opts: Options): string {
    const envEntries = opts.env
      ? Object.entries(opts.env).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
      : []
    return JSON.stringify({
      cwd: opts.cwd ?? '',
      model: opts.model ?? '',
      effort: opts.effort ?? '',
      permissionMode: opts.permissionMode ?? 'default',
      bypass: opts.allowDangerouslySkipPermissions ?? false,
      sandbox: opts.sandbox ? `${!!opts.sandbox.enabled}|${!!opts.sandbox.autoAllowBashIfSandboxed}` : '',
      additionalDirectories: [...(opts.additionalDirectories ?? [])].sort(),
      env: envEntries,
      cli: opts.pathToClaudeCodeExecutable ?? '',
      resume: opts.resume ?? '',
      resumeSessionAt: opts.resumeSessionAt ?? '',
      resumeDropsTurn: opts.resumeDropsTurn ?? '',
      forkSession: opts.forkSession ?? false,
      sessionId: opts.sessionId ?? '',
      previewFormat: opts.toolConfig?.askUserQuestion?.previewFormat ?? '',
    })
  }

  prewarm(options: Options): void {
    if (this.disposed) return
    const key = WarmupManager.keyOf(options)

    if (this.slot && this.slot.key === key) {
      const age = Date.now() - this.slot.createdAt
      if (age < STALE_TTL_MS) {
        if (this.slot.idleTimer) clearTimeout(this.slot.idleTimer)
        this.startSlotIdleTimer(this.slot)
        return
      }
      log.info('[warmup] discarding stale slot (age=%dms) and re-warming', age)
      this.discardSlot('stale')
    }

    if (this.inflightKey === key) return

    if (this.slot && this.slot.key !== key) this.discardSlot('key_changed')
    if (this.inflightKey && this.inflightKey !== key) {
      log.info('[warmup] superseding inflight (key changed)')
    }

    this.inflightKey = key
    const abortController = options.abortController ?? new AbortController()
    const startupOptions = options.abortController ? options : { ...options, abortController }
    log.info('[warmup] startup() begin key=%s', shortKey(key))
    const t0 = Date.now()
    startup({ options: startupOptions }).then((warm) => {
      const dur = Date.now() - t0
      if (this.disposed || this.inflightKey !== key) {
        log.info('[warmup] startup() resolved but superseded (durMs=%d)', dur)
        try { warm.close() } catch { /* ignore */ }
        try { abortController.abort() } catch { /* ignore */ }
        return
      }
      const slot: WarmupSlot = { key, warm, createdAt: Date.now(), abortController, idleTimer: null }
      this.startSlotIdleTimer(slot)
      this.slot = slot
      this.inflightKey = null
      log.info('[warmup] startup() ready durMs=%d key=%s', dur, shortKey(key))
      trace('warmup', 'ready', { key, durMs: dur })
    }).catch((err) => {
      if (this.inflightKey === key) this.inflightKey = null
      const e = err as NodeJS.ErrnoException
      const envSize = Object.entries(process.env).reduce((n, [k, v]) => n + k.length + (v?.length ?? 0) + 2, 0)
      const pathLen = (process.env.PATH ?? '').length
      const cwd = (() => { try { return process.cwd() } catch { return '<cwd-error>' } })()
      const binDiag = probeClaudeBinary(options)
      log.warn(
        '[warmup] startup() failed msg=%s code=%s errno=%s syscall=%s cwd=%s(len=%d) envBytes=%d pathLen=%d cli=%s diag=%s stack=%s',
        e?.message ?? String(err),
        e?.code ?? 'none',
        e?.errno ?? 'none',
        e?.syscall ?? 'none',
        cwd, cwd.length,
        envSize,
        pathLen,
        options.pathToClaudeCodeExecutable ?? 'none',
        binDiag,
        e?.stack ?? 'none',
      )
      trace('warmup', 'error', { key, error: String(err), code: e?.code, errno: e?.errno, syscall: e?.syscall, envBytes: envSize, pathLen, cwd, binDiag })
    })
  }

  consume(options: Options): { warm: WarmQuery; abortController: AbortController } | null {
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
    const { warm, abortController, idleTimer } = this.slot
    if (idleTimer) clearTimeout(idleTimer)
    log.info('[warmup] HIT — consumed slot ageMs=%d key=%s', age, shortKey(key))
    trace('warmup', 'hit', { key, ageMs: age })
    this.slot = null
    return { warm, abortController }
  }

  private discardSlot(reason: string): void {
    if (!this.slot) return
    log.info('[warmup] discard slot reason=%s key=%s', reason, shortKey(this.slot.key))
    if (this.slot.idleTimer) clearTimeout(this.slot.idleTimer)
    try { this.slot.warm.close() } catch { /* ignore */ }
    try { this.slot.abortController.abort() } catch { /* ignore */ }
    this.slot = null
  }

  dispose(): void {
    this.disposed = true
    this.discardSlot('dispose')
    this.inflightKey = null
  }
}

let _globalWarmupManager: WarmupManager | null = null

export function getGlobalWarmupManager(): WarmupManager {
  if (!_globalWarmupManager) _globalWarmupManager = new WarmupManager()
  return _globalWarmupManager
}

export function disposeGlobalWarmupManager(): void {
  if (_globalWarmupManager) {
    _globalWarmupManager.dispose()
    _globalWarmupManager = null
  }
}

function shortKey(key: string): string {
  return key.length > 80 ? `${key.slice(0, 80)}…` : key
}
