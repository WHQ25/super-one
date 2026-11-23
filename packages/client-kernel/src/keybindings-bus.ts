import { createDisposer } from './disposer'
import type {
  CommandsBus,
  KernelDisposer,
  KeybindingContext,
  KeybindingContextResolver,
  KeybindingDefinition,
  KeybindingsBus,
} from './types'

interface StoredKeybinding {
  seq: number
  definition: KeybindingDefinition
  parsed: ParsedChord
}

interface ParsedChord {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  mod: boolean
  key: string
}

function isMacPlatform(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.platform === 'string') {
    return /mac/i.test(navigator.platform)
  }
  return false
}

export function parseKeyChord(spec: string): ParsedChord {
  const parts = spec.trim().toLowerCase().split('+').filter(Boolean)
  const parsed: ParsedChord = { ctrl: false, meta: false, alt: false, shift: false, mod: false, key: '' }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i < parts.length - 1) {
      if (part === 'ctrl' || part === 'control') parsed.ctrl = true
      else if (part === 'meta' || part === 'cmd' || part === 'command') parsed.meta = true
      else if (part === 'alt' || part === 'option' || part === 'opt') parsed.alt = true
      else if (part === 'shift') parsed.shift = true
      else if (part === 'mod' || part === 'cmdorctrl') parsed.mod = true
    } else {
      parsed.key = part === 'esc' ? 'escape' : part === 'space' ? ' ' : part
    }
  }
  return parsed
}

function matchesChord(event: KeyboardEvent, parsed: ParsedChord, mac: boolean): boolean {
  const wantMeta = parsed.meta || (parsed.mod && mac)
  const wantCtrl = parsed.ctrl || (parsed.mod && !mac)
  if (Boolean(event.metaKey) !== wantMeta) return false
  if (Boolean(event.ctrlKey) !== wantCtrl) return false
  if (Boolean(event.altKey) !== parsed.alt) return false
  if (Boolean(event.shiftKey) !== parsed.shift) return false
  if (!parsed.key) return false
  const eventKey = event.key.toLowerCase()
  if (eventKey === parsed.key) return true
  if (parsed.key.length === 1 && /^[a-z]$/.test(parsed.key)) {
    return event.code === `Key${parsed.key.toUpperCase()}`
  }
  return event.code.toLowerCase() === parsed.key
}

export function createKeybindingsBus(commands: CommandsBus): KeybindingsBus {
  let nextSeq = 1
  const entries: StoredKeybinding[] = []
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of [...listeners]) listener()
  }

  function sortedEntries(): StoredKeybinding[] {
    return [...entries].sort((a, b) => {
      const pa = a.definition.priority ?? 0
      const pb = b.definition.priority ?? 0
      if (pa !== pb) return pb - pa
      return b.seq - a.seq
    })
  }

  function executeEntry(entry: StoredKeybinding, ctx: KeybindingContext, event: KeyboardEvent | null): boolean {
    const { handler, command, args } = entry.definition
    if (handler) {
      const outcome = handler(ctx, event)
      if (outcome === false) return false
      return true
    }
    if (command) {
      if (!commands.hasCommand(command)) return false
      void commands.executeCommand(command, ...(args ?? [ctx]))
      return true
    }
    return false
  }

  return {
    registerKeybinding(definition: KeybindingDefinition): KernelDisposer {
      const entry: StoredKeybinding = {
        seq: nextSeq++,
        definition,
        parsed: parseKeyChord(definition.key),
      }
      entries.push(entry)
      notify()
      return createDisposer(() => {
        const idx = entries.indexOf(entry)
        if (idx >= 0) entries.splice(idx, 1)
        notify()
      })
    },

    handleKeyEvent(
      event: KeyboardEvent,
      resolveContext: KeybindingContextResolver,
      options?: { capture?: boolean },
    ): boolean {
      if (event.defaultPrevented) return false
      const mac = isMacPlatform()
      const wantCapture = options?.capture === true
      const ctx = resolveContext(event)

      for (const entry of sortedEntries()) {
        if (Boolean(entry.definition.capture) !== wantCapture) continue
        if (!matchesChord(event, entry.parsed, mac)) continue
        if (ctx.inTerminal && !entry.definition.allowInTerminal) continue
        if (entry.definition.when && !entry.definition.when(ctx)) continue
        if (!executeEntry(entry, ctx, event)) continue
        if (entry.definition.preventDefault !== false) {
          event.preventDefault()
        }
        return true
      }
      return false
    },

    dispatchShortcut(commandIdOrSpec: string, ctx: KeybindingContext): boolean {
      const normalized = commandIdOrSpec.trim().toLowerCase()
      for (const entry of sortedEntries()) {
        const matchesId = entry.definition.id === commandIdOrSpec || entry.definition.command === commandIdOrSpec
        const matchesKey = entry.definition.key.trim().toLowerCase() === normalized
        if (!matchesId && !matchesKey) continue
        if (ctx.inTerminal && !entry.definition.allowInTerminal) continue
        if (entry.definition.when && !entry.definition.when(ctx)) continue
        if (executeEntry(entry, ctx, null)) return true
      }
      return false
    },

    listKeybindings(): readonly KeybindingDefinition[] {
      return sortedEntries().map((e) => e.definition)
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
