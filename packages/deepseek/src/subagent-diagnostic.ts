/**
 * Recovering a subagent's provider-authored failure detail.
 *
 * rc.8 added `SubagentResult.diagnostic`: non-assistant failure text a provider
 * writes for a non-`completed` run, guaranteed free of tool inputs, file
 * contents, environment values, credentials and raw protocol payloads, and
 * capped at 4096 UTF-8 bytes.
 *
 * It does not reach a host as a field. `SubagentRunEndInfo` — the payload of
 * `subagent/end`, which is where SuperOne closes its Task block — carries
 * `runId`, `provider`, `id`, `local`, `stopReason` and `lastAssistantMessage`,
 * and no diagnostic. The only place the value surfaces is the error
 * `dsh-tool-subagent` throws when it settles a foreground run, where
 * `withDiagnosticAndPartialText()` composes:
 *
 * ```
 * <stop-reason headline>
 * Diagnostic: <provider text>
 * Partial output before the run ended:
 * <the child's partial assistant output>
 * ```
 *
 * So parsing that string is not a shortcut around a typed API — it is the only
 * seam upstream offers. The parse is deliberately narrow: it recognises the two
 * exact literals upstream emits and yields nothing when they are absent, so a
 * change to that format costs the extra detail and never corrupts the message.
 * `subagent-diagnostic.test.ts` pins the format against upstream's own wording.
 *
 * The split matters as much as the extraction. The partial assistant output
 * after the second marker is the CHILD'S OWN answer; upstream keeps it separate
 * from the diagnostic and so does SuperOne, which renders the diagnostic as
 * failure detail rather than as something the agent said.
 */

/** Exactly what `withDiagnosticAndPartialText()` prefixes the diagnostic with. */
const DIAGNOSTIC_MARKER = '\nDiagnostic: '

/** Exactly what it prefixes the child's preserved partial answer with. */
const PARTIAL_OUTPUT_MARKER = '\nPartial output before the run ended:\n'

/**
 * Upstream's own cap, in UTF-8 bytes. Re-checked here rather than trusted: a
 * provider is documented to respect it, and a host that assumed compliance
 * would let one misbehaving provider push an unbounded string into the store
 * and into every render of that Task block.
 */
export const SUBAGENT_DIAGNOSTIC_MAX_BYTES = 4096

/**
 * Cut a string to at most `maxBytes` UTF-8 bytes without splitting a character.
 *
 * `TextEncoder`/`TextDecoder` do the work: encoding gives the true byte length,
 * and decoding a truncated buffer with `fatal: false` replaces a partial
 * trailing sequence, which is then dropped. Slicing by `.length` would count
 * UTF-16 units and cut emoji and CJK text mid-character.
 * @param value - the text to bound.
 * @param maxBytes - the inclusive byte budget.
 * @returns `value` unchanged when it already fits, else a shortened copy.
 */
export function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength <= maxBytes) return value
  const decoded = new TextDecoder('utf-8').decode(encoded.subarray(0, maxBytes))
  // A replacement char here is the tail of a sequence the cut split; dropping it
  // is what keeps the result valid text rather than ending in U+FFFD.
  return decoded.endsWith('�') ? decoded.slice(0, -1) : decoded
}

/**
 * Pull the provider diagnostic out of a settled subagent tool failure.
 *
 * @param message - the error text `dsh-tool-subagent` threw.
 * @returns the diagnostic alone, bounded to the documented cap, or `undefined`
 *   when the failure carried none.
 */
export function extractSubagentDiagnostic(message: string): string | undefined {
  // Upstream emits the diagnostic BEFORE the partial output, so everything from
  // the partial-output marker onward is the child's own text and is excluded
  // from the search first. Without this the child could put the marker in its
  // own answer and have that answer presented as provider failure detail.
  const partialAt = message.indexOf(PARTIAL_OUTPUT_MARKER)
  const head = partialAt === -1 ? message : message.slice(0, partialAt)

  const start = head.indexOf(DIAGNOSTIC_MARKER)
  if (start === -1) return undefined
  // The diagnostic may itself span lines, so it runs to the end of the head
  // rather than to the next newline.
  const diagnostic = head.slice(start + DIAGNOSTIC_MARKER.length).trim()
  if (diagnostic.length === 0) return undefined
  return truncateUtf8(diagnostic, SUBAGENT_DIAGNOSTIC_MAX_BYTES)
}
