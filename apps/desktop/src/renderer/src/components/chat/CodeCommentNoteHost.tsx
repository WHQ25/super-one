import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore, type ChatStore, type ReplyComment, type SessionWriteTarget } from '@/stores/chat'
import { newReplyCommentId } from '@/stores/chat-store/helpers/reply-comments'
import { useIsDark } from '@/hooks/use-is-dark'
import { Z_CLASS } from '@/lib/z-layers'
import { stickyForComment, stickyForDraft } from './plan-sticky-palette'
import { StickyNoteEditor } from './plan-sticky-visuals'
import {
  closeCodeCommentNote,
  getCodeCommentNote,
  setCodeCommentNoteText,
  subscribeCodeCommentNote,
  type CodeCommentNoteState,
} from './code-comment-note'

const NOTE_WIDTH = 220
const NOTE_HEIGHT = 210
const EMPTY_COMMENTS: ReplyComment[] = []

function replyCommentsFor(state: ChatStore, target?: SessionWriteTarget): ReplyComment[] {
  const projectPath = target?.projectPath ?? state.activeProject
  const project = projectPath ? state.projectSessions[projectPath] : undefined
  const sessionId = target?.sessionId ?? project?._activeSessionId
  if (!project || !sessionId) return EMPTY_COMMENTS
  return project._sessions[sessionId]?.replyComments ?? EMPTY_COMMENTS
}

function placeNote(x: number, y: number): { left: number; top: number } {
  const vw = window.innerWidth || 1024
  const vh = window.innerHeight || 768
  const left = Math.max(8, Math.min(x, vw - NOTE_WIDTH - 12))
  const below = y + 8
  const above = y - NOTE_HEIGHT - 8
  const top = below + NOTE_HEIGHT > vh - 8 && above >= 8 ? above : Math.max(8, below)
  return { left, top }
}

/** The sticky note for comments on code and diffs. One host, portaled above the editor. */
export function CodeCommentNoteHost() {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const note = useSyncExternalStore(subscribeCodeCommentNote, getCodeCommentNote, getCodeCommentNote)
  const noteRef = useRef(note)
  noteRef.current = note
  const boxRef = useRef<HTMLDivElement>(null)
  const comments = useChatStore((s) => replyCommentsFor(s, note?.target))
  const actions = useChatStore(useShallow((s) => ({
    add: s.addReplyComment,
    update: s.updateReplyComment,
    remove: s.removeReplyComment,
  })))

  useEffect(() => () => { closeCodeCommentNote() }, [])

  const save = useCallback((current: CodeCommentNoteState) => {
    if (!noteRef.current) return
    noteRef.current = null
    const text = current.text.trim()
    if (current.mode === 'edit' && current.id) {
      if (text) actions.update(current.id, text, current.target)
      else actions.remove(current.id, current.target)
    } else if (text) {
      actions.add({
        id: newReplyCommentId(),
        messageId: null,
        anchorText: current.quote,
        quote: current.quote,
        text,
        surface: 'code',
      }, current.target)
    }
    closeCodeCommentNote()
  }, [actions])

  useEffect(() => {
    if (!note) return
    const onKeyDown = (event: KeyboardEvent) => {
      const el = document.activeElement
      if (!(el instanceof HTMLTextAreaElement) || el.dataset.planDraft === undefined || !boxRef.current?.contains(el)) return
      if (event.key === 'Enter') {
        event.stopPropagation()
        if ((event.metaKey || event.ctrlKey) && !event.isComposing) {
          event.preventDefault()
          const current = noteRef.current
          if (current) save(current)
        }
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeCodeCommentNote()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [note, save])

  if (!note || typeof document === 'undefined') return null
  const swatch = note.mode === 'edit' && note.id
    ? stickyForComment(note.id, comments)
    : stickyForDraft(comments.length)
  const pos = placeNote(note.x, note.y)

  return createPortal(
    <div
      ref={boxRef}
      data-testid="code-comment-note"
      data-plan-sticky-ui
      className={`pointer-events-auto fixed ${Z_CLASS.PLAN_NOTE}`}
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <StickyNoteEditor
        key={note.mode === 'edit' ? note.id : `draft:${note.quote}`}
        swatch={swatch}
        isDark={isDark}
        autoFocus
        value={note.text}
        placeholder={t('chat.plan.commentPlaceholder')}
        dismissLabel={note.mode === 'edit' ? t('chat.plan.removeComment') : t('chat.plan.cancelComment')}
        onChange={setCodeCommentNoteText}
        onDismiss={() => {
          const current = noteRef.current
          if (current?.mode === 'edit' && current.id) actions.remove(current.id, current.target)
          closeCodeCommentNote()
        }}
        onCommit={() => {
          const current = noteRef.current
          if (current) save(current)
        }}
      />
    </div>,
    document.body,
  )
}
