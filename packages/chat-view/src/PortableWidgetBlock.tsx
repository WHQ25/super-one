import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bookmark, Check, Loader2 } from 'lucide-react'
import type { WidgetData } from '@superone/shared/generative-ui/types'
import { buildWidgetSrcdoc, widgetThemeVars } from '@superone/shared/generative-ui/widget-srcdoc'
import { requestNative, requestNativeAsync } from './bridge'
import { PortableTurnContext } from './portable-turn-context'

/**
 * A code widget on the phone.
 *
 * The desktop mounts `WidgetBlock`; the phone mounts this, and both run the agent's
 * HTML through the same `buildWidgetSrcdoc`. The chat surface here is already a
 * WebView, so the widget lives in an iframe *inside* it — the sandbox attribute is
 * what keeps agent-authored code off the chat document, exactly as on the desktop.
 *
 * Three things differ, and all three come from being on a phone:
 *
 *  - **Scrolling.** The widget document sets `overflow:hidden` and reports its height,
 *    so the iframe is always as tall as its content and never scrolls internally. On a
 *    desktop that leaves the wheel bridge to move the page; on a phone a drag inside
 *    the frame would simply do nothing, stranding the transcript. `touchScroll` forwards
 *    non-interactive vertical drags so the chat keeps scrolling under the widget.
 *  - **Chrome is always visible.** The desktop reveals the title and actions on hover.
 *    There is no hover on a phone, so hiding them would hide them permanently.
 *  - **Links, prompts and saving** cross the native bridge: opening a browser tab is not
 *    possible from this document, there is no chat store to write a draft into, and the
 *    template store lives on the host's disk rather than the phone's.
 */
const MIN_HEIGHT = 80

type SaveState =
  | { kind: 'idle' }
  | { kind: 'editing' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'failed'; message: string }

/**
 * The transcript's own resolved colours, in the widget's token vocabulary.
 *
 * Read from the block's own node, not from `document.documentElement`: the scheme
 * class and the brand hue are applied by whoever mounts the transcript, and reading
 * the root assumes that is always the same element. Resolving against the node the
 * widget actually sits in returns whatever cascade reaches it — which is the only
 * definition of "the colours around this widget" that cannot go stale.
 */
function useHostWidgetTheme(
  node: HTMLElement | null,
  scheme: 'light' | 'dark',
): Record<string, string> {
  return useMemo(() => {
    if (!node) return {}
    const styles = getComputedStyle(node)
    return widgetThemeVars((token) => styles.getPropertyValue(token))
    // `scheme` is not read in the body: it is the signal that the computed values moved.
  }, [node, scheme])
}

function SaveForm({ data, onDone }: { data: WidgetData; onDone: (state: SaveState) => void }) {
  const { t } = useTranslation()
  const { projectPath } = useContext(PortableTurnContext)
  const [title, setTitle] = useState(data.title.replace(/_/g, ' '))
  const [description, setDescription] = useState(data.reusable?.description ?? '')
  const [scope, setScope] = useState<'project' | 'user'>(projectPath ? 'project' : 'user')
  const [busy, setBusy] = useState(false)

  const submit = useCallback(async () => {
    setBusy(true)
    onDone({ kind: 'saving' })
    try {
      await requestNativeAsync('saveWidgetTemplate', {
        id: data.templateId ?? data.reusable?.id ?? title,
        title,
        code: data.widget_code,
        description: description || undefined,
        inputSchema: data.reusable?.inputSchema,
        scope,
      })
      onDone({ kind: 'saved' })
    } catch (error) {
      onDone({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [data, title, description, scope, onDone])

  const scopeButton = (value: 'project' | 'user', label: string, disabled?: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setScope(value)}
      className={`flex-1 rounded px-2 py-1.5 text-xs ${scope === value
        ? 'bg-primary text-primary-foreground'
        : 'bg-muted text-muted-foreground'} disabled:opacity-40`}
    >
      {label}
    </button>
  )

  return (
    <div className="mt-1.5 flex flex-col gap-2 rounded-md bg-muted/40 p-2.5">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={t('widget.save.namePlaceholder')}
        aria-label={t('widget.save.namePlaceholder')}
        className="rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
      />
      <input
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder={t('widget.save.descriptionPlaceholder')}
        aria-label={t('widget.save.descriptionPlaceholder')}
        className="rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
      />
      <div className="flex gap-2">
        {/* A live phone session always has a project, but a transcript replayed without
            one must not offer a scope the host would reject. */}
        {scopeButton('project', t('widget.save.scopeProject'), !projectPath)}
        {scopeButton('user', t('widget.save.scopeUser'))}
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onDone({ kind: 'idle' })}
          className="rounded px-3 py-1.5 text-xs text-muted-foreground"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          disabled={busy || !title.trim()}
          onClick={() => { void submit() }}
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-40"
        >
          {t('widget.save.confirm')}
        </button>
      </div>
    </div>
  )
}

export function PortableWidgetBlock({ data }: { data: WidgetData }) {
  const { t } = useTranslation()
  const { scheme } = useContext(PortableTurnContext)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(Math.max(MIN_HEIGHT, data.height))
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  // The chat document stamps `color-scheme` from the host theme, so the widget has to
  // declare the same one or the engine stops compositing the frame transparently and
  // paints its own light canvas behind the widget's transparent body.
  const [srcdoc] = useState(() =>
    buildWidgetSrcdoc(data.widget_code, data.isSVG, { touchScroll: true, colorScheme: scheme }),
  )
  // State, not a ref: the theme cannot be resolved until the node is in the document,
  // and a ref would not re-render to deliver it.
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const vars = useHostWidgetTheme(root, scheme)

  const postTheme = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'widget-theme', dark: scheme === 'dark', colorScheme: scheme, vars },
      '*',
    )
  }, [scheme, vars])

  useEffect(() => { postTheme() }, [postTheme])

  useLayoutEffect(() => {
    const handler = (event: MessageEvent) => {
      // The chat document's own host bridge listens on this same window, so a widget
      // frame must be identified by source rather than by message shape.
      if (event.source !== iframeRef.current?.contentWindow) return
      const message = event.data as { type?: string; height?: number; text?: string; url?: string; deltaY?: number }
      switch (message?.type) {
        case 'widget-ready':
          postTheme()
          break
        case 'widget-resize':
          if (typeof message.height === 'number' && message.height > 0) {
            setHeight(Math.max(MIN_HEIGHT, message.height))
          }
          break
        case 'widget-sendPrompt':
          if (typeof message.text === 'string') requestNative('setDraft', { text: message.text })
          break
        case 'widget-openLink':
          if (typeof message.url === 'string') requestNative('openLink', { url: message.url })
          break
        case 'widget-touch-scroll':
          if (typeof message.deltaY === 'number') globalThis.scrollBy(0, message.deltaY)
          break
      }
    }
    globalThis.addEventListener('message', handler)
    return () => globalThis.removeEventListener('message', handler)
  }, [postTheme])

  const displayTitle = data.title.replace(/_/g, ' ')
  const saveLabel = data.templateId ? t('widget.save.updateTitle') : t('widget.save.title')

  return (
    // The horizontal inset is the block's own: the transcript's padding stops here, and
    // a frame running to the screen edge is part of what made a widget read as a panel
    // dropped into the conversation rather than as part of the reply.
    <div ref={setRoot} className="my-2 w-full px-1" data-widget-title={data.title}>
      <div className="mb-1 flex h-6 items-center gap-1.5 px-0.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70">{displayTitle}</span>
        {save.kind === 'saving' ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground/70" aria-label={saveLabel} />
        ) : save.kind === 'saved' ? (
          <Check className="size-3.5 shrink-0 text-success" aria-label={t('widget.save.confirm')} />
        ) : (
          <button
            type="button"
            aria-label={saveLabel}
            aria-expanded={save.kind === 'editing'}
            onClick={() => setSave(save.kind === 'editing' ? { kind: 'idle' } : { kind: 'editing' })}
            // Negative margin keeps the drawn glyph small while the tap target stays
            // finger-sized, the same trade the tool rows make with `hitSlop`.
            className="-m-2 shrink-0 p-2 text-muted-foreground/70"
          >
            <Bookmark className={`size-3.5 ${data.templateId ? 'fill-current' : ''}`} />
          </button>
        )}
      </div>
      <iframe
        ref={iframeRef}
        title={displayTitle}
        srcDoc={srcdoc}
        onLoad={postTheme}
        sandbox="allow-scripts"
        className="w-full rounded-md border-0"
        style={{ height }}
      />
      {save.kind === 'editing' ? <SaveForm data={data} onDone={setSave} /> : null}
      {save.kind === 'failed' ? (
        <p className="mt-1 px-0.5 text-xs text-error">{t('widget.save.failed', { error: save.message })}</p>
      ) : null}
    </div>
  )
}
