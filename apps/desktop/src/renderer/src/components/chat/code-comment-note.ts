import { useChatStore, type ReplyComment, type SessionWriteTarget } from '@/stores/chat'

/** A code or diff comment being written, or an existing one being edited. */
export interface CodeCommentNoteState {
  mode: 'draft' | 'edit'
  id?: string
  quote: string
  text: string
  x: number
  y: number
  target?: SessionWriteTarget
}

type Listener = () => void

let note: CodeCommentNoteState | null = null
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function activeSessionTarget(): SessionWriteTarget | undefined {
  const state = useChatStore.getState()
  const projectPath = state.activeProject
  if (!projectPath) return undefined
  const sessionId = state.projectSessions[projectPath]?._activeSessionId ?? undefined
  if (!sessionId) return undefined
  return { projectPath, sessionId }
}

export function getCodeCommentNote(): CodeCommentNoteState | null {
  return note
}

export function subscribeCodeCommentNote(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function closeCodeCommentNote(): void {
  if (!note) return
  note = null
  emit()
}

export function setCodeCommentNoteText(text: string): void {
  if (!note || note.text === text) return
  note = { ...note, text }
  emit()
}

/** Open the same sticky note chat comments use, quoting `quote` (a file selection or diff). */
export function openCodeCommentDraft(quote: string, x: number, y: number, target?: SessionWriteTarget): void {
  const trimmed = quote.trim()
  if (!trimmed) return
  note = {
    mode: 'draft',
    quote: trimmed,
    text: '',
    x,
    y,
    target: target ?? activeSessionTarget(),
  }
  emit()
}

export function openCodeCommentEdit(comment: ReplyComment, x: number, y: number, target?: SessionWriteTarget): void {
  note = {
    mode: 'edit',
    id: comment.id,
    quote: comment.quote,
    text: comment.text,
    x,
    y,
    target: target ?? activeSessionTarget(),
  }
  emit()
}
