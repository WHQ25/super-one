import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { NewlineKeys } from '@superone/ui/components/ui/kbd'

const TRANSITION = { duration: 0.2, ease: [0.2, 0, 0, 1] as const }
const TEXT_METRICS = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
  'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'box-sizing',
  'border-top-width', 'border-bottom-width', 'border-left-width', 'border-right-width',
  'white-space', 'overflow-wrap', 'word-break', 'text-indent',
]

/** Keep one mounted feedback field while its actions move between compact and expanded layouts. */
export function PermissionActionsLayout({
  feedback, feedbackValue, children, minInlineWidth = 512,
}: {
  feedback: ReactNode
  feedbackValue: string
  children: ReactNode
  minInlineWidth?: number
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLTextAreaElement>(null)
  const [layout, setLayout] = useState({ wide: false, expanded: false })
  const reduceMotion = useReducedMotion()
  const { t } = useTranslation()
  const isMac = window.app?.platform === 'darwin'

  const measure = useCallback(() => {
    const root = rootRef.current
    const actions = actionsRef.current
    const input = root?.querySelector<HTMLTextAreaElement>('textarea[data-feedback]')
    const probe = probeRef.current
    if (!root || !actions || !input || !probe) return

    // Use layout sizes, not the animated bounding rect. Always measure the hypothetical
    // inline width, so expansion cannot make its own trigger disappear.
    const wide = root.clientWidth >= minInlineWidth
    let expanded = wide && feedbackValue.includes('\n')
    if (wide && !expanded && feedbackValue) {
      const style = getComputedStyle(input)
      for (const property of TEXT_METRICS) probe.style.setProperty(property, style.getPropertyValue(property))
      probe.style.width = `${Math.max(1, root.clientWidth - actions.offsetWidth - 8)}px`
      probe.value = ''
      const oneRowHeight = probe.scrollHeight
      probe.value = feedbackValue
      expanded = probe.scrollHeight > oneRowHeight
    }
    setLayout((current) => current.wide === wide && current.expanded === expanded ? current : { wide, expanded })
  }, [feedbackValue, minInlineWidth])

  useLayoutEffect(() => {
    measure()
    const observer = new ResizeObserver(measure)
    if (rootRef.current) observer.observe(rootRef.current)
    if (actionsRef.current) observer.observe(actionsRef.current)
    document.fonts?.addEventListener('loadingdone', measure)
    return () => {
      observer.disconnect()
      document.fonts?.removeEventListener('loadingdone', measure)
    }
  }, [measure])

  const inline = layout.wide && !layout.expanded
  return (
    <motion.div
      ref={rootRef}
      layout={!reduceMotion}
      transition={TRANSITION}
      data-feedback-layout={layout.wide ? inline ? 'inline' : 'expanded' : 'stacked'}
      className="relative grid w-full min-w-0 items-start gap-2"
      style={{ gridTemplateColumns: inline ? 'max-content minmax(0, 1fr)' : 'minmax(0, 1fr)' }}
    >
      <motion.div
        layout={!reduceMotion}
        transition={TRANSITION}
        className="min-w-0"
        style={{ gridColumn: inline ? 2 : 1, gridRow: 1 }}
      >
        {feedback}
      </motion.div>
      <motion.div
        layout={reduceMotion ? false : 'position'}
        transition={TRANSITION}
        className="relative flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2"
        style={{
          gridColumn: 1,
          gridRow: inline ? 1 : 2,
          justifySelf: 'start',
          width: inline ? 'max-content' : '100%',
        }}
      >
        <div
          ref={actionsRef}
          className="flex max-w-full shrink-0 flex-wrap items-center gap-2"
          style={{ width: layout.wide ? 'max-content' : '100%' }}
        >
          {children}
        </div>
        <AnimatePresence initial={false} mode="popLayout">
          {layout.expanded && (
            <motion.span
              key="newline-hint"
              initial={reduceMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ ...TRANSITION, duration: reduceMotion ? 0 : 0.16 }}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground"
            >
              <NewlineKeys label={t('chat.permission.feedbackNewlineHint')} mac={isMac} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
      <textarea
        ref={probeRef}
        aria-hidden
        tabIndex={-1}
        readOnly
        rows={1}
        className="pointer-events-none invisible absolute h-0 min-h-0 overflow-hidden border-0"
      />
    </motion.div>
  )
}
