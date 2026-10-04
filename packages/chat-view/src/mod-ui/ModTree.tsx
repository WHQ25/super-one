import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@superone/ui/components/ui/select'
import type { ModChild, ModCodeProps, ModElement, ModPrimitive, ModRenderComponent, ModStyledElement } from '@superone/shared/mod-ui'
import type { ModUiClient } from './client'
import { boxStyle, textStyle } from './cells'
import { svgDataUrl } from './svg'
import { ModDiff } from './ModDiff'
import { ClientFrame } from './ClientFrame'

/** Platform renderers a tree borrows (desktop and phone draw Markdown and code differently). */
export interface ModUiPorts {
  renderMarkdown?: (text: string, options: { dimColor?: boolean }) => ReactNode
  renderCode?: (props: ModCodeProps) => ReactNode
  /** Opens an `https`/`http://localhost` link outside the app. */
  openLink?: (href: string) => void
  /** Draws an openable `Link` the way chat draws web links (favicon, open behavior); give it `data-streamdown="link"`. */
  renderLink?: (href: string, children: ReactNode) => ReactNode
}

export interface ModTreeEnv {
  client: ModUiClient
  component: ModRenderComponent
  instanceId: string
  ports: ModUiPorts
  /** SuperOne's own drawing of the site, for `engine` nodes. */
  renderEngine?: (props: Record<string, unknown>) => ReactNode
  /** Props the first non-zero engine ref draws with (the plugin's rewrite). */
  rewrittenProps: Record<string, unknown>
  /** Props every other engine ref draws with (what the ask carried). */
  requestProps: Record<string, unknown>
  /** The ref whose props crossed the wire, or 0 when none did. */
  firstRef: number
  /** Per plugin, the hash of the `Client` modules this tree draws. */
  clientModules?: Record<string, string>
  /** Where pressables send; a `Client` tree routes them to its own module. Default: the session. */
  act?: ModUiClient['act']
}

/** Sends a control's op where the tree it sits in routes it. */
function actIn(env: ModTreeEnv): ModUiClient['act'] {
  return env.act ?? env.client.act.bind(env.client)
}

const EnvContext = createContext<ModTreeEnv | null>(null)
const HoverContext = createContext(false)

/** The first engine ref ≠ 0, depth first: the only one the CLI sends props for. */
export function firstEngineRef(node: ModChild): number {
  if (typeof node === 'string') return 0
  if (node.type === 'engine') return node.ref
  if (!('children' in node) || !node.children) return 0
  for (const child of node.children) {
    const ref = firstEngineRef(child)
    if (ref !== 0) return ref
  }
  return 0
}

/** How many `engine` nodes a tree carries. */
export function countEngineRefs(node: ModChild): number {
  if (typeof node === 'string') return 0
  if (node.type === 'engine') return 1
  if (!('children' in node) || !node.children) return 0
  return node.children.reduce((n, child) => n + countEngineRefs(child), 0)
}

/**
 * A tree as one line of text, for a site SuperOne shows as plain text (the
 * composer hint). Each engine node contributes `engineText(ref)`.
 */
export function treePlainText(node: ModChild, engineText: (ref: number) => string): string {
  if (typeof node === 'string') return node
  if (node.type === 'engine') return engineText(node.ref)
  if (!('children' in node) || !node.children) return ''
  const sep = node.type === 'Box' && node.props?.flexDirection === 'column' ? ' ' : ''
  return node.children.map((child) => treePlainText(child, engineText)).join(sep)
}

export function ModTree({ tree, env }: { tree: ModElement; env: ModTreeEnv }) {
  return (
    <EnvContext.Provider value={env}>
      <Node node={tree} />
    </EnvContext.Provider>
  )
}

function useEnv(): ModTreeEnv {
  const env = useContext(EnvContext)
  if (!env) throw new Error('ModTree element outside a tree')
  return env
}

function Children({ nodes, inText }: { nodes?: ModChild[]; inText?: boolean }) {
  if (!nodes) return null
  return (
    <>
      {nodes.map((child, i) =>
        typeof child === 'string'
          ? inText ? child : <span key={i} style={textStyle()}>{child}</span>
          : <Node key={elementKey(child, i)} node={child} />,
      )}
    </>
  )
}

function elementKey(node: ModElement, index: number): string {
  const key = node.type !== 'engine' && node.props && 'key' in node.props ? node.props.key : undefined
  return typeof key === 'string' ? `${node.type}:${key}` : `${node.type}#${index}`
}

function useHoverStyle(hover: Record<string, ModPrimitive> | undefined, styleOf: (p: Record<string, ModPrimitive>) => CSSProperties): CSSProperties | undefined {
  const hovered = useContext(HoverContext)
  return hovered && hover ? pick(styleOf(hover)) : undefined
}

/** Only the properties a hover override actually set. */
function pick(style: CSSProperties): CSSProperties {
  return Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined)) as CSSProperties
}

function Node({ node }: { node: ModElement }): ReactNode {
  switch (node.type) {
    case 'Box':
    case 'div':
      return <BoxNode node={node} />
    case 'Text':
    case 'span':
    case 'b':
      return <TextNode node={node} />
    case 'Button':
      return <ButtonNode node={node} />
    case 'Input':
      return <InputNode node={node} />
    case 'Select':
      return <SelectNode node={node} />
    case 'Link':
      return <LinkNode node={node} />
    case 'Code':
      return <CodeNode props={node.props} />
    case 'Markdown':
      return <MarkdownNode node={node} />
    case 'Svg':
      return <SvgNode props={node.props} />
    case 'Client':
      return <ClientNode node={node} />
    case 'engine':
      return <EngineNode ref_={node.ref} />
  }
}

function BoxNode({ node }: { node: ModStyledElement }) {
  const [hovered, setHovered] = useState(false)
  const inherited = useContext(HoverContext)
  const scoped = typeof node.props?.key === 'string'
  const hoverStyle = useHoverStyle(node.hover, boxStyle)
  const style = { ...boxStyle(node.props), ...hoverStyle }
  const box = (
    <div
      style={style}
      data-mod-key={scoped ? String(node.props?.key) : undefined}
      onPointerEnter={scoped ? () => setHovered(true) : undefined}
      onPointerLeave={scoped ? () => setHovered(false) : undefined}
    >
      <Children nodes={node.children} />
    </div>
  )
  return scoped ? <HoverContext.Provider value={hovered || inherited}>{box}</HoverContext.Provider> : box
}

function TextNode({ node }: { node: ModStyledElement }) {
  const hoverStyle = useHoverStyle(node.hover, textStyle)
  const base = node.type === 'b' ? { ...textStyle(node.props), fontWeight: 600 } : textStyle(node.props)
  return (
    <span style={{ ...base, ...hoverStyle }}>
      <Children nodes={node.children} inText />
    </span>
  )
}

/** How long a hotkey press stays drawn; the op itself usually answers sooner. */
const HOTKEY_PRESS_MS = 220
const PRESSED_CLASS = 'data-[pressed]:ring-[3px] data-[pressed]:ring-ring/50'

/**
 * Press a control from its hotkey. A click from the keyboard has no `:active`
 * state, and a press whose only effect is a held toast changes nothing on
 * screen, so the button is drawn pressed for a moment.
 */
export function pressModHotkey(button: HTMLElement): void {
  button.dataset.pressed = ''
  setTimeout(() => delete button.dataset.pressed, HOTKEY_PRESS_MS)
  button.click()
}

/** Runs one control's op and keeps the control disabled while it is in flight. */
function usePending(): [boolean, (run: () => Promise<unknown>) => void] {
  const [pending, setPending] = useState(false)
  return [pending, (run) => {
    setPending(true)
    void run().finally(() => setPending(false))
  }]
}

function ButtonNode({ node }: { node: Extract<ModElement, { type: 'Button' }> }) {
  const env = useEnv()
  const [pending, run] = usePending()
  const { key, label, hotkey, variant, plain, dimColor, role, autoFocus } = node.props
  const press = () =>
    run(() =>
      actIn(env)('press', { plugin: node.press.plugin, handle: node.press.handle, key, surface: env.client.surface, clientId: env.client.clientId }, env),
    )
  // The phone has no keyboard for hotkeys and no terminal look to keep: a
  // bordered button in the UI font (`plain` only drops a terminal's brackets).
  const touch = env.client.surface === 'mobile'
  const data = { 'data-mod-control': '', 'data-mod-key': key, 'data-mod-plugin': node.press.plugin, 'data-mod-hotkey': touch ? undefined : hotkey }
  if (role === 'dismiss') {
    return (
      <Button {...data} type="button" size={touch ? 'icon-sm' : 'icon-xs'} variant="ghost" className={`${touch ? 'size-7' : ''} ${PRESSED_CLASS}`} aria-label={label} title={label} disabled={pending} onClick={press} autoFocus={autoFocus}>
        <X />
      </Button>
    )
  }
  return (
    <Button
      {...data}
      type="button"
      size={touch ? 'sm' : 'xs'}
      variant={plain && !touch ? 'ghost' : variant === 'primary' ? 'default' : 'outline'}
      className={`w-fit shrink-0 font-normal ${touch ? 'h-7 px-2.5 font-sans' : ''} ${PRESSED_CLASS}`}
      style={dimColor ? { opacity: 0.62 } : undefined}
      disabled={pending}
      onClick={press}
      autoFocus={autoFocus}
    >
      {label}
      {hotkey && !touch ? <Kbd className="ml-0.5">{hotkey}</Kbd> : null}
    </Button>
  )
}

function InputNode({ node }: { node: Extract<ModElement, { type: 'Input' }> }) {
  const env = useEnv()
  const { key, label, placeholder, value, submitLabel, autoFocus } = node.props
  // The surface keeps what the person types; a redraw only resets it when the plugin's value changes.
  const [text, setText] = useState(value ?? '')
  useEffect(() => setText(value ?? ''), [value])
  const send = (kind: 'change' | 'submit', next: string) =>
    actIn(env)(
      'input',
      { plugin: node.press.plugin, handle: node.press.handle, kind, value: next, key, component: env.component, instanceId: env.instanceId, surface: env.client.surface, clientId: env.client.clientId },
      kind === 'submit' ? env : undefined,
    )
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs">
      {label ? <span className="shrink-0 text-muted-foreground">{label}</span> : null}
      <Input
        data-mod-control=""
        data-mod-key={key}
        data-mod-plugin={node.press.plugin}
        className="h-7 min-w-0 flex-1 text-xs"
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => {
          setText(e.target.value)
          void send('change', e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
          e.preventDefault()
          void send('submit', text)
        }}
      />
      {submitLabel ? (
        <Button type="button" size="xs" variant="outline" className="font-normal" onClick={() => void send('submit', text)}>
          {submitLabel}
        </Button>
      ) : null}
    </label>
  )
}

function SelectNode({ node }: { node: Extract<ModElement, { type: 'Select' }> }) {
  const env = useEnv()
  const { key, label, options, value } = node.props
  const [picked, setPicked] = useState(value ?? '')
  useEffect(() => setPicked(value ?? ''), [value])
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs">
      {label ? <span className="shrink-0 text-muted-foreground">{label}</span> : null}
      <Select
        value={picked}
        onValueChange={(next) => {
          setPicked(next)
          void actIn(env)(
            'select',
            { plugin: node.press.plugin, handle: node.press.handle, value: next, key, component: env.component, instanceId: env.instanceId, surface: env.client.surface, clientId: env.client.clientId },
            env,
          )
        }}
      >
        <SelectTrigger size="sm" className="h-7 min-w-24 text-xs" data-mod-control="" data-mod-key={key} data-mod-plugin={node.press.plugin}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label ?? o.value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function isOpenable(href: string): boolean {
  return /^https:\/\//i.test(href) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(href)
}

function LinkNode({ node }: { node: Extract<ModElement, { type: 'Link' }> }) {
  const env = useEnv()
  const { href, label } = node.props
  const content = node.children?.length ? <Children nodes={node.children} inText /> : (label ?? href)
  // Only web links open; anything else stays text.
  if (!isOpenable(href)) return <span title={href}>{content}</span>
  // Inside `chat-md`, so it takes chat's link color.
  if (env.ports.renderLink) return <span className="chat-md">{env.ports.renderLink(href, content)}</span>
  const open = (e: MouseEvent) => {
    e.preventDefault()
    env.ports.openLink?.(href)
  }
  return (
    <a href={href} onClick={open} className="text-primary underline-offset-2 hover:underline" title={href}>
      {content}
    </a>
  )
}

function CodeNode({ props }: { props: ModCodeProps }) {
  const env = useEnv()
  if (props.format === 'diff') return <ModDiff source={props.source} wrap={props.wrap} />
  if (env.ports.renderCode) return <div className="min-w-0">{env.ports.renderCode(props)}</div>
  return <pre className="min-w-0 overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-xs leading-[var(--mod-row,1.5em)]">{props.source}</pre>
}

function MarkdownNode({ node }: { node: Extract<ModElement, { type: 'Markdown' }> }) {
  const env = useEnv()
  const { text, dimColor, pressableLinks, key } = node.props
  // Links answer through the plugin when it holds a press handle (all of them,
  // or the ones `pressableLinks` names); the rest open outside the app.
  const onClickCapture = (e: MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    if (!href) return
    e.preventDefault()
    e.stopPropagation()
    if (node.press && (!pressableLinks || pressableLinks.includes(href))) {
      void env.client.act('press', { plugin: node.press.plugin, handle: node.press.handle, key, href, surface: env.client.surface, clientId: env.client.clientId }, env)
    } else if (isOpenable(href)) {
      env.ports.openLink?.(href)
    }
  }
  return (
    <div className="min-w-0 text-sm" style={dimColor ? { opacity: 0.62 } : undefined} onClickCapture={onClickCapture}>
      {env.ports.renderMarkdown ? env.ports.renderMarkdown(text, { dimColor }) : <span style={textStyle()}>{text}</span>}
    </div>
  )
}

function SvgNode({ props }: { props: Extract<ModElement, { type: 'Svg' }>['props'] }) {
  const url = useMemo(() => svgDataUrl(props.source), [props.source])
  const size: CSSProperties = {
    width: typeof props.width === 'number' ? `${props.width}ch` : undefined,
    height: typeof props.height === 'number' ? `calc(${props.height} * var(--mod-row, 1.5em))` : undefined,
    maxWidth: '100%',
  }
  if (!url) return <span style={textStyle({ dimColor: true })}>{props.alt}</span>
  return <img src={url} alt={props.alt} style={size} className="object-contain" draggable={false} />
}

function ClientNode({ node }: { node: Extract<ModElement, { type: 'Client' }> }) {
  return <ClientFrame node={node} env={useEnv()} />
}

function EngineNode({ ref_ }: { ref_: number }) {
  const env = useEnv()
  if (!env.renderEngine) return null
  return <>{env.renderEngine(ref_ !== 0 && ref_ === env.firstRef ? env.rewrittenProps : env.requestProps)}</>
}
