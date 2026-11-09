export interface AntigravityStepMetadata {
  createdAtMs: number
  viewableAtMs: number
  completedAtMs: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  thoughtsTokens: number
  candidatesTokens: number
  contextWindow: number
  model: string
}

export interface AntigravityPlannerResponse {
  responseText: string
  thinkingText: string
  thinkingDurationMs: number
}

function readVarint(buf: Uint8Array, offset: number): { value: number; nextOffset: number } | null {
  let result = 0n
  let shift = 0n
  let pos = offset
  while (pos < buf.length) {
    const byte = buf[pos++]
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) {
      return { value: Number(result), nextOffset: pos }
    }
    shift += 7n
    if (shift > 63n) return null
  }
  return null
}

function skipWireValue(buf: Uint8Array, offset: number, wireType: number): number | null {
  if (wireType === 0) {
    const v = readVarint(buf, offset)
    return v ? v.nextOffset : null
  }
  if (wireType === 1) {
    return offset + 8 <= buf.length ? offset + 8 : null
  }
  if (wireType === 2) {
    const len = readVarint(buf, offset)
    if (!len || len.value < 0 || len.nextOffset + len.value > buf.length) return null
    return len.nextOffset + len.value
  }
  if (wireType === 5) {
    return offset + 4 <= buf.length ? offset + 4 : null
  }
  return null
}

function parseProtoDurationOrTimestampMs(buf: Uint8Array): number {
  let pos = 0
  let seconds = 0
  let nanos = 0
  while (pos < buf.length) {
    const tag = readVarint(buf, pos)
    if (!tag) break
    pos = tag.nextOffset
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 0x7
    if (wireType === 0 && (fieldNumber === 1 || fieldNumber === 2)) {
      const val = readVarint(buf, pos)
      if (!val) break
      pos = val.nextOffset
      if (fieldNumber === 1) seconds = val.value
      else nanos = val.value
    } else {
      const next = skipWireValue(buf, pos, wireType)
      if (next === null) break
      pos = next
    }
  }
  if (seconds <= 0 && nanos <= 0) return 0
  return seconds * 1000 + Math.round(nanos / 1_000_000)
}

function parseModelUsageStats(buf: Uint8Array): {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  thoughtsTokens: number
  candidatesTokens: number
} {
  let pos = 0
  let model = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let thoughtsTokens = 0
  let candidatesTokens = 0
  const decoder = new TextDecoder()

  while (pos < buf.length) {
    const tag = readVarint(buf, pos)
    if (!tag) break
    pos = tag.nextOffset
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 0x7
    if (wireType === 2 && fieldNumber === 1) {
      const len = readVarint(buf, pos)
      if (!len || len.value < 0 || len.nextOffset + len.value > buf.length) break
      model = decoder.decode(buf.subarray(len.nextOffset, len.nextOffset + len.value)).trim()
      pos = len.nextOffset + len.value
    } else if (
      wireType === 0 &&
      (fieldNumber === 2 ||
        fieldNumber === 3 ||
        fieldNumber === 5 ||
        fieldNumber === 8 ||
        fieldNumber === 9 ||
        fieldNumber === 10)
    ) {
      const val = readVarint(buf, pos)
      if (!val) break
      pos = val.nextOffset
      if (fieldNumber === 2) inputTokens = val.value
      else if (fieldNumber === 3) outputTokens = val.value
      else if (fieldNumber === 5 || (fieldNumber === 8 && cacheReadTokens === 0)) cacheReadTokens = val.value
      else if (fieldNumber === 9) thoughtsTokens = val.value
      else if (fieldNumber === 10) candidatesTokens = val.value
    } else {
      const next = skipWireValue(buf, pos, wireType)
      if (next === null) break
      pos = next
    }
  }

  return { model, inputTokens, outputTokens, cacheReadTokens, thoughtsTokens, candidatesTokens }
}

function parseModelInfo(buf: Uint8Array): { contextWindow: number; model: string } {
  let pos = 0
  let contextWindow = 0
  let model = ''
  const decoder = new TextDecoder()

  while (pos < buf.length) {
    const tag = readVarint(buf, pos)
    if (!tag) break
    pos = tag.nextOffset
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 0x7
    if (wireType === 0 && fieldNumber === 4) {
      const val = readVarint(buf, pos)
      if (!val) break
      pos = val.nextOffset
      contextWindow = val.value
    } else if (wireType === 2 && fieldNumber === 8) {
      const len = readVarint(buf, pos)
      if (!len || len.value < 0 || len.nextOffset + len.value > buf.length) break
      model = decoder.decode(buf.subarray(len.nextOffset, len.nextOffset + len.value)).trim()
      pos = len.nextOffset + len.value
    } else {
      const next = skipWireValue(buf, pos, wireType)
      if (next === null) break
      pos = next
    }
  }

  return { contextWindow, model }
}

export function parseAntigravityStepMetadata(buf: Uint8Array): AntigravityStepMetadata {
  let pos = 0
  let createdAtMs = 0
  let viewableAtMs = 0
  let completedAtMs = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let thoughtsTokens = 0
  let candidatesTokens = 0
  let contextWindow = 0
  let model = ''
  let fallbackModel = ''

  while (pos < buf.length) {
    const tag = readVarint(buf, pos)
    if (!tag) break
    pos = tag.nextOffset
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 0x7
    if (
      wireType === 2 &&
      (fieldNumber === 1 || fieldNumber === 6 || fieldNumber === 8 || fieldNumber === 9 || fieldNumber === 24)
    ) {
      const len = readVarint(buf, pos)
      if (!len || len.value < 0 || len.nextOffset + len.value > buf.length) break
      const sub = buf.subarray(len.nextOffset, len.nextOffset + len.value)
      pos = len.nextOffset + len.value
      if (fieldNumber === 1) {
        createdAtMs = parseProtoDurationOrTimestampMs(sub)
      } else if (fieldNumber === 6) {
        viewableAtMs = parseProtoDurationOrTimestampMs(sub)
      } else if (fieldNumber === 8) {
        completedAtMs = parseProtoDurationOrTimestampMs(sub)
      } else if (fieldNumber === 9) {
        const stats = parseModelUsageStats(sub)
        inputTokens = stats.inputTokens
        outputTokens = stats.outputTokens
        cacheReadTokens = stats.cacheReadTokens
        thoughtsTokens = stats.thoughtsTokens
        candidatesTokens = stats.candidatesTokens
        if (stats.model && !stats.model.startsWith('MODEL_PLACEHOLDER_')) {
          fallbackModel = stats.model
        }
      } else if (fieldNumber === 24) {
        const info = parseModelInfo(sub)
        if (info.contextWindow > 0) contextWindow = info.contextWindow
        if (info.model) model = info.model
      }
    } else {
      const next = skipWireValue(buf, pos, wireType)
      if (next === null) break
      pos = next
    }
  }

  return {
    createdAtMs,
    viewableAtMs,
    completedAtMs,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    thoughtsTokens,
    candidatesTokens,
    contextWindow,
    model: model || fallbackModel,
  }
}

export function normalizeAntigravityThinkingText(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\n(?:[ \t]*\n)+/g, '\n\n').trim()
}

function parseInnerPlannerResponse(buf: Uint8Array): AntigravityPlannerResponse {
  let pos = 0
  let responseText = ''
  let thinkingText = ''
  let thinkingDurationMs = 0
  const decoder = new TextDecoder()

  while (pos < buf.length) {
    const tag = readVarint(buf, pos)
    if (!tag) break
    pos = tag.nextOffset
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 0x7
    if (wireType === 2 && (fieldNumber === 1 || fieldNumber === 3 || fieldNumber === 11)) {
      const len = readVarint(buf, pos)
      if (!len || len.value < 0 || len.nextOffset + len.value > buf.length) break
      const sub = buf.subarray(len.nextOffset, len.nextOffset + len.value)
      pos = len.nextOffset + len.value
      if (fieldNumber === 1) {
        responseText = decoder.decode(sub)
      } else if (fieldNumber === 3) {
        thinkingText = normalizeAntigravityThinkingText(decoder.decode(sub))
      } else if (fieldNumber === 11) {
        thinkingDurationMs = parseProtoDurationOrTimestampMs(sub)
      }
    } else {
      const next = skipWireValue(buf, pos, wireType)
      if (next === null) break
      pos = next
    }
  }

  return { responseText, thinkingText, thinkingDurationMs }
}

export function parseAntigravityPlannerResponse(buf: Uint8Array): AntigravityPlannerResponse {
  let pos = 0
  while (pos < buf.length) {
    const tag = readVarint(buf, pos)
    if (!tag) break
    pos = tag.nextOffset
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 0x7
    if (wireType === 2 && fieldNumber === 20) {
      const len = readVarint(buf, pos)
      if (!len || len.value < 0 || len.nextOffset + len.value > buf.length) break
      return parseInnerPlannerResponse(buf.subarray(len.nextOffset, len.nextOffset + len.value))
    }
    const next = skipWireValue(buf, pos, wireType)
    if (next === null) break
    pos = next
  }
  return { responseText: '', thinkingText: '', thinkingDurationMs: 0 }
}

export function extractStepEnvelope(buf: Uint8Array): {
  metadataBuf: Uint8Array | null
  hasUserInput: boolean
  plannerResponse: AntigravityPlannerResponse | null
} {
  let pos = 0
  let metadataBuf: Uint8Array | null = null
  let hasUserInput = false
  let plannerResponse: AntigravityPlannerResponse | null = null

  while (pos < buf.length) {
    const tag = readVarint(buf, pos)
    if (!tag) break
    pos = tag.nextOffset
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 0x7
    if (wireType === 2 && (fieldNumber === 1 || fieldNumber === 14 || fieldNumber === 20)) {
      const len = readVarint(buf, pos)
      if (!len || len.value < 0 || len.nextOffset + len.value > buf.length) break
      const sub = buf.subarray(len.nextOffset, len.nextOffset + len.value)
      pos = len.nextOffset + len.value
      if (fieldNumber === 1) metadataBuf = sub
      else if (fieldNumber === 14) hasUserInput = true
      else if (fieldNumber === 20) plannerResponse = parseInnerPlannerResponse(sub)
    } else {
      const next = skipWireValue(buf, pos, wireType)
      if (next === null) break
      pos = next
    }
  }

  return { metadataBuf, hasUserInput, plannerResponse }
}

export function stepTotalOutputTokens(meta: AntigravityStepMetadata): number {
  if (meta.candidatesTokens > 0 && meta.outputTokens >= meta.candidatesTokens + meta.thoughtsTokens) {
    return meta.outputTokens
  }
  return meta.outputTokens + meta.thoughtsTokens
}

export interface AntigravityTurnTokenState {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  contextTokens: number
  prevPrompt: number
  prevContext: number
}

export function createAntigravityTurnTokenState(
  preTurnPromptTokens = 0,
  preTurnContextTokens = 0,
): AntigravityTurnTokenState {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    contextTokens: 0,
    prevPrompt: preTurnPromptTokens,
    prevContext: preTurnContextTokens,
  }
}

export function recordAntigravityPreTurnStep(
  state: AntigravityTurnTokenState,
  uncachedInputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
): void {
  const stepPrompt = uncachedInputTokens + cacheReadTokens
  const stepContext = stepPrompt + outputTokens
  if (stepPrompt > 0 || outputTokens > 0) {
    state.prevPrompt = stepPrompt
    state.prevContext = stepContext
  }
}

export function accumulateAntigravityTurnStep(
  state: AntigravityTurnTokenState,
  uncachedInputTokens: number,
  cacheReadTokens: number,
  outputTokens: number,
): void {
  const stepPrompt = uncachedInputTokens + cacheReadTokens
  const stepContext = stepPrompt + outputTokens
  if (stepPrompt > 0) {
    if (state.prevPrompt > 0 && stepPrompt < state.prevPrompt) {
      state.prevPrompt = stepPrompt
      state.prevContext = stepContext
    } else {
      const baseline = Math.max(state.prevContext, cacheReadTokens)
      state.inputTokens += Math.max(0, stepPrompt - baseline)
      state.prevPrompt = stepPrompt
      state.prevContext = stepContext
    }
  } else if (outputTokens > 0 && state.prevContext > 0) {
    state.prevContext += outputTokens
  }
  state.outputTokens += outputTokens
  state.cacheReadTokens += cacheReadTokens
  if (stepContext > 0) {
    state.contextTokens = stepContext
  }
}
