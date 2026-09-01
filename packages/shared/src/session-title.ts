/**
 * Cap for a session title *derived* from the first user message.
 *
 * Every surface that derives a fallback title (desktop main, renderer, remote
 * node, the JSONL history scan, voice) must use this one number — they used to
 * carry independent `100`s kept in sync by comment only. Agent-authored titles
 * (`session_rename`) are short by construction and are not clipped here.
 *
 * The sidebar can only show ~25 characters of it; the rest is reachable by
 * hovering the row, which scrolls the title (`useHoverMarquee`).
 */
export const SESSION_TITLE_MAX_CHARS = 200
