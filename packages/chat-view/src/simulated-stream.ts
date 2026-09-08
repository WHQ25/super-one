import type { ChatMessage } from '@superone/shared/agent-types'

const MAX_BACKLOG_MS = 5_000
type Location = { kind: 'content' | 'codex'; index: number; property: 'text' | 'thinking' | 'content' }
type Field = Location & {
  key: string; text: string; shown: number; anchor: number
  ends: number[]; costs: number[]; spent: number
}
type Entry = {
  source: ChatMessage; rendered: ChatMessage; index: number; fields: Field[]
  remaining: number; lastTime: number; deadline: number
}

/** The fallback keeps combining marks, emoji sequences and surrogate pairs intact. */
function graphemes(text: string): { segment: string; index: number }[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text))
  }
  const result: { segment: string; index: number }[] = []
  let offset = 0
  let regionalCount = 0
  for (const character of text) {
    const previous = result.at(-1)
    const regional = /\p{Regional_Indicator}/u.test(character)
    const joins = previous && (
      /[\p{Mark}\uFE0E\uFE0F\u200D\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u.test(character)
      || previous.segment.endsWith('\u200D')
      || (character === '\n' && previous.segment === '\r')
      || (regional && regionalCount % 2 === 1)
    )
    if (joins) previous.segment += character
    else result.push({ segment: character, index: offset })
    regionalCount = regional ? regionalCount + 1 : 0
    offset += character.length
  }
  return result
}

function fields(message: ChatMessage): (Location & { key: string; text: string })[] {
  if (message.role !== 'assistant' || message.providerId === 'system') return []
  const result: (Location & { key: string; text: string })[] = []
  const codex = message.metadata?.codex
  codex?.items.forEach((item, index) => {
    if (item.type === 'agent_message' || item.type === 'plan' || item.type === 'reasoning') {
      result.push({ kind: 'codex', index, property: 'text', key: `codex:${item.id}:${item.type}`, text: item.text })
    }
  })
  // CodexTurnView renders items, then content text only as a missing-answer fallback.
  // The final content copy must not consume a second, invisible animation budget.
  if (codex?.items.some((item) => item.type === 'agent_message' || item.type === 'plan')) return result
  message.content.forEach((content, index) => {
    // Insight is a legacy remote block that is not part of the current TS union.
    const block = content as { type: string; text?: string; thinking?: string; content?: string }
    if (codex && block.type !== 'text') return
    const property = block.type === 'text' ? 'text' : block.type === 'thinking' ? 'thinking'
      : block.type === 'insight' ? 'content' : null
    if (property && typeof block[property] === 'string') {
      result.push({ kind: 'content', index, property, key: `content:${index}:${block.type}`, text: block[property] })
    }
  })
  return result
}

function settled(field: ReturnType<typeof fields>[number]): Field {
  return { ...field, shown: field.text.length, anchor: field.text.length, ends: [], costs: [], spent: 0 }
}

function total(field: Field): number { return field.costs.at(-1) ?? 0 }

/** Only the previous final grapheme is segmented again when a chunk is appended. */
function append(field: Field, text: string): void {
  const wasVisible = field.shown === field.text.length
  const hadText = field.text.length > 0
  if (!field.ends.length && hadText) {
    field.anchor = graphemes(field.text).at(-1)?.index ?? 0
  }
  const start = field.ends.length > 1 ? field.ends[field.ends.length - 2] : field.anchor
  if (field.ends.length) { field.ends.pop(); field.costs.pop() }
  let cost = total(field)
  const prefixCount = field.ends.length
  for (const { segment, index } of graphemes(text.slice(start))) {
    cost += /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(segment) ? 15 : 10
    field.ends.push(start + index + segment.length)
    field.costs.push(cost)
  }
  field.text = text
  if (wasVisible && hadText) field.spent = field.costs[prefixCount] ?? cost
  reveal(field)
}

function reveal(field: Field): void {
  let low = 0
  let high = field.costs.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (field.costs[middle] <= field.spent) low = middle + 1
    else high = middle
  }
  field.shown = low ? field.ends[low - 1] : field.anchor
}

function project(entry: Entry): ChatMessage {
  const hidden = entry.fields.filter((field) => field.shown < field.text.length)
  if (!hidden.length) return entry.source
  const message = { ...entry.source }
  if (hidden.some((field) => field.kind === 'content')) message.content = [...message.content]
  if (hidden.some((field) => field.kind === 'codex') && message.metadata?.codex) {
    message.metadata = { ...message.metadata, codex: { ...message.metadata.codex, items: [...message.metadata.codex.items] } }
  }
  for (const field of hidden) {
    const text = field.text.slice(0, field.shown)
    if (field.kind === 'content') {
      message.content[field.index] = { ...message.content[field.index], [field.property]: text }
    } else {
      const items = message.metadata!.codex!.items
      items[field.index] = { ...items[field.index], text } as typeof items[number]
    }
  }
  return message
}

/** Mobile presentation only: transport/reducer state and message status stay authoritative. */
export class SimulatedStream {
  private entries = new Map<string, Entry>()
  private active = new Map<string, Entry>()
  private displayed: ChatMessage[] = []
  private ids: ReadonlySet<string> = new Set()
  private reasoningIds: ReadonlySet<string> = new Set()

  get messages(): ChatMessage[] { return this.displayed }
  get revealingIds(): ReadonlySet<string> { return this.ids }
  get revealingReasoningIds(): ReadonlySet<string> { return this.reasoningIds }
  get pending(): boolean { return this.active.size > 0 }

  nextDelayMs(now: number): number {
    let delay = 33
    for (const entry of this.active.values()) delay = Math.min(delay, Math.max(0, entry.deadline - now))
    return this.pending ? delay : 0
  }

  reset(messages: ChatMessage[]): void {
    this.entries.clear()
    this.active.clear()
    this.displayed = messages
    messages.forEach((message, index) => this.entries.set(message.id, this.baseline(message, index)))
    this.ids = new Set()
    this.reasoningIds = new Set()
  }

  prepend(messages: ChatMessage[]): void {
    const older = messages.filter((message) => !this.entries.has(message.id))
    if (!older.length) return
    // A page can contain duplicates as well as overlap with the loaded transcript.
    const unique = [...new Map(older.map((message) => [message.id, message])).values()]
    for (const entry of this.entries.values()) entry.index += unique.length
    unique.forEach((message, index) => this.entries.set(message.id, this.baseline(message, index)))
    this.displayed = [...unique, ...this.displayed]
  }

  update(messages: ChatMessage[], now: number): void {
    this.advance(now)
    const entries = new Map<string, Entry>()
    const displayed: ChatMessage[] = []
    messages.forEach((message, index) => {
      let entry = this.entries.get(message.id)
      if (!entry || entry.source !== message) {
        const previous = new Map(entry?.fields.map((field) => [field.key, field]))
        const animate = message.status !== 'interrupted' && message.status !== 'error'
        const nextFields = fields(message).map((next) => {
          const old = previous.get(next.key)
          if (!animate || (old && !next.text.startsWith(old.text))) return settled(next)
          const field = old ? { ...old, ...next, text: old.text } : settled({ ...next, text: '' })
          if (field.text !== next.text) append(field, next.text)
          return field
        })
        const remaining = nextFields.reduce((sum, field) => sum + total(field) - field.spent, 0)
        entry = {
          source: message, rendered: message, index, fields: nextFields, remaining,
          lastTime: now, deadline: entry?.remaining ? entry.deadline : now + MAX_BACKLOG_MS,
        }
        entry.rendered = project(entry)
      }
      entry.index = index
      entries.set(message.id, entry)
      displayed.push(entry.rendered)
    })
    this.entries = entries
    this.active = new Map([...entries].filter(([, entry]) => entry.remaining > 0))
    this.ids = new Set(this.active.keys())
    this.refreshReasoningIds()
    if (displayed.length !== this.displayed.length || displayed.some((message, i) => message !== this.displayed[i])) {
      this.displayed = displayed
    }
  }

  advance(now: number): void {
    let displayed: ChatMessage[] | undefined
    let finished = false
    for (const [id, entry] of this.active) {
      const expired = now >= entry.deadline
      const elapsed = Math.max(0, now - entry.lastTime)
      const timeLeft = Math.max(0, entry.deadline - entry.lastTime)
      let budget = timeLeft === 0 || expired ? Infinity
        : elapsed * Math.max(1, entry.remaining / timeLeft)
      entry.lastTime = Math.max(now, entry.lastTime)
      let changed = false
      for (const field of entry.fields) {
        const spend = Math.min(total(field) - field.spent, budget)
        if (spend <= 0) continue
        const before = field.shown
        field.spent += spend
        entry.remaining -= spend
        budget -= spend
        reveal(field)
        changed ||= before !== field.shown
        if (budget <= 0) break
      }
      if (expired || entry.remaining < 1e-7) {
        for (const field of entry.fields) {
          changed ||= field.shown !== field.text.length
          field.spent = total(field)
          field.shown = field.text.length
        }
        entry.remaining = 0
        this.active.delete(id)
        finished = true
      }
      if (changed) {
        entry.rendered = project(entry)
        displayed ??= [...this.displayed]
        displayed[entry.index] = entry.rendered
      }
    }
    if (displayed) this.displayed = displayed
    if (finished) this.ids = new Set(this.active.keys())
    if (displayed || finished) this.refreshReasoningIds()
  }

  private refreshReasoningIds(): void {
    const ids = new Set<string>()
    for (const [id, entry] of this.active) {
      if (entry.fields.some((field) => field.shown < field.text.length && (
        field.property === 'thinking'
        || (field.kind === 'codex' && entry.source.metadata?.codex?.items[field.index]?.type === 'reasoning')
      ))) ids.add(id)
    }
    if (ids.size !== this.reasoningIds.size || [...ids].some((id) => !this.reasoningIds.has(id))) {
      this.reasoningIds = ids
    }
  }

  private baseline(message: ChatMessage, index: number): Entry {
    return { source: message, rendered: message, index, fields: fields(message).map(settled), remaining: 0, lastTime: 0, deadline: 0 }
  }
}
