import type {
  Bounds,
  CapturedImage,
  CaptureScope,
  CoordinateSpace,
  ObserveMode,
  UiAction,
  UiOutlineNode,
  UiRootIdentity,
} from '../types'
import type {
  PlatformActRequest,
  PlatformActResult,
  PlatformActStepResult,
  PlatformAdapter,
  PlatformLook,
} from './types'

const DISPLAY: CoordinateSpace = {
  width: 1440,
  height: 900,
  scale: 2,
  fullScreen: true,
  kind: 'display',
  capturedBounds: { x: 0, y: 0, width: 1440, height: 900 },
  displayBounds: { x: 0, y: 0, width: 1440, height: 900 },
}

export interface FakeElementSpec {
  role: string
  name?: string
  value?: string
  bounds?: Bounds
  enabled?: boolean
  focused?: boolean
  /** Clicks / presses are accepted by the API but produce no effect. */
  ignoreEvents?: boolean
  /** When pressed, append a modal dialog root. */
  opensModal?: { title: string; buttonName: string }
  /** When pressed, toggle value between 'off' and 'on'. */
  toggle?: boolean
  children?: FakeElementSpec[]
}

export interface FakeWindowSpec {
  title: string
  windowId?: number
  kind?: UiRootIdentity['kind']
  bounds?: Bounds
  focused?: boolean
  modal?: boolean
  tree: FakeElementSpec
}

export interface FakeAppSpec {
  app: string
  bundleId: string
  pid: number
  windows: FakeWindowSpec[]
}

interface LiveElement {
  id: string
  /** Stable public ref across looks for the same live node (`@eN`). */
  publicRef?: string
  role: string
  name?: string
  value?: string
  bounds: Bounds
  enabled: boolean
  focused: boolean
  ignoreEvents: boolean
  opensModal?: { title: string; buttonName: string }
  toggle: boolean
  children: LiveElement[]
}

interface LiveWindow {
  key: string
  windowId?: number
  title: string
  kind: UiRootIdentity['kind']
  bounds: Bounds
  focused: boolean
  visible: boolean
  minimized: boolean
  modal: boolean
  tree: LiveElement
  /** Incremented when tree topology changes in ways that invalidate old refs. */
  topologyGen: number
}

interface LiveApp {
  app: string
  bundleId: string
  pid: number
  windows: LiveWindow[]
}

/**
 * Deterministic fake desktop for contract tests.
 * Mutable world state; each look renumbers element refs from `@e1`.
 */
export class FakePlatformBackend implements PlatformAdapter {
  private apps: LiveApp[] = []
  private elementSeq = 0
  private lookSeq = 0
  private frontmostPid: number | null = null
  /** When true, act() returns applied=true but no mutation (silent delivery). */
  silentDelivery = false
  /** Wall-clock for wait_for tests (optional). */
  nowMs = 0

  constructor(specs?: FakeAppSpec[]) {
    this.reset(specs ?? defaultWorld())
  }

  reset(specs: FakeAppSpec[] = defaultWorld()): void {
    this.elementSeq = 0
    this.lookSeq = 0
    this.silentDelivery = false
    this.nowMs = 0
    this.apps = specs.map((s) => this.buildApp(s))
    this.frontmostPid = this.apps[0]?.pid ?? null
    for (const app of this.apps) {
      for (const w of app.windows) {
        if (w.focused) this.frontmostPid = app.pid
      }
    }
  }

  /** Test helper: replace a window tree without changing app identity. */
  replaceWindowTree(pid: number, title: string, tree: FakeElementSpec): void {
    const app = this.apps.find((a) => a.pid === pid)
    if (!app) throw new Error(`fake: unknown pid ${pid}`)
    const win = app.windows.find((w) => w.title === title)
    if (!win) throw new Error(`fake: unknown window ${title}`)
    win.tree = this.buildElement(tree)
    win.topologyGen += 1
  }

  /** Test helper: append a delayed element after N ms of fake time. */
  scheduleChild(
    pid: number,
    title: string,
    parentName: string,
    child: FakeElementSpec,
  ): void {
    const node = this.findLiveByName(pid, title, parentName)
    if (!node) throw new Error(`fake: parent ${parentName} not found`)
    node.children.push(this.buildElement(child))
  }

  advanceTime(ms: number): void {
    this.nowMs += ms
  }

  /** Test helper: remove a native window between observe and act. */
  removeWindow(pid: number, target: number | string): void {
    const app = this.apps.find((candidate) => candidate.pid === pid)
    if (!app) throw new Error(`fake: unknown pid ${pid}`)
    app.windows = app.windows.filter((window) =>
      typeof target === 'number' ? window.windowId !== target : window.title !== target,
    )
  }

  async listRoots(): Promise<Array<Omit<UiRootIdentity, 'rootId'>>> {
    const roots: Array<Omit<UiRootIdentity, 'rootId'>> = []
    for (const app of this.apps) {
      for (const w of app.windows) {
        roots.push(this.toRootMeta(app, w))
      }
    }
    return roots
  }

  async look(
    root: UiRootIdentity,
    mode: ObserveMode,
    capture: CaptureScope,
  ): Promise<PlatformLook> {
    const { app, win } = this.resolveWindow(root)
    this.lookSeq += 1
    // Keep publicRef stable across looks for the same live node so wait_for /
    // postconditions can re-evaluate by ref after re-observation. New nodes
    // (modals, delayed children) allocate fresh @eN ids.
    const outline = this.toOutline(win.tree)
    const coordinateSpace = capture === 'display'
      ? { ...DISPLAY }
      : {
          width: win.bounds.width,
          height: win.bounds.height,
          scale: 2,
          fullScreen: false,
          kind: 'window' as const,
          capturedBounds: { ...win.bounds },
        }
    const image =
      mode === 'semantic'
        ? undefined
        : placeholderImage(root.rootId || win.title, coordinateSpace)

    return {
      root: this.toRootMeta(app, win),
      outline,
      image,
      coordinateSpace,
      nativeLookId: `look-${this.lookSeq}-g${win.topologyGen}`,
    }
  }

  async act(req: PlatformActRequest): Promise<PlatformActResult> {
    const { app, win } = this.resolveWindow(req.root)
    const steps: PlatformActStepResult[] = []
    let focusRef = req.focusRef
    let stoppedAt: number | undefined

    for (let i = 0; i < req.actions.length; i++) {
      const action = req.actions[i]!
      const step = this.applyOne(app, win, action, focusRef, req.delivery)
      steps.push(step)
      if (step.focusRef) focusRef = step.focusRef
      if (!step.applied || step.confirmedNoEffect || step.unknown) {
        // Continue only when applied cleanly; stop on failure / unknown for checked txn.
        if (!step.applied || step.confirmedNoEffect) {
          stoppedAt = i
          break
        }
        if (step.unknown) {
          stoppedAt = i
          break
        }
      }
    }

    return { steps, stoppedAt }
  }

  async zoom(
    _root: UiRootIdentity,
    region: [number, number, number, number],
    _coordinateSpace: CoordinateSpace,
  ): Promise<CapturedImage> {
    const [x0, y0, x1, y1] = region
    const w = Math.max(1, Math.round(x1 - x0))
    const h = Math.max(1, Math.round(y1 - y0))
    return {
      mimeType: 'image/png',
      data: `fake-zoom:${x0},${y0},${x1},${y1}`,
      width: w * DISPLAY.scale,
      height: h * DISPLAY.scale,
    }
  }

  async focusApp(appName: string): Promise<void> {
    const app = this.apps.find(
      (a) => a.app === appName || a.bundleId === appName,
    )
    if (!app) throw new Error(`fake: app not found: ${appName}`)
    this.frontmostPid = app.pid
    for (const a of this.apps) {
      for (const w of a.windows) w.focused = a.pid === app.pid && !w.modal
    }
    const primary = app.windows.find((w) => !w.modal) ?? app.windows[0]
    if (primary) primary.focused = true
  }

  async launchApp(appName: string): Promise<void> {
    const existing = this.apps.find(
      (a) => a.app === appName || a.bundleId === appName,
    )
    if (existing) {
      await this.focusApp(appName)
      return
    }
    // Launch a minimal stub window.
    const pid = 9000 + this.apps.length
    this.apps.push(
      this.buildApp({
        app: appName,
        bundleId: `fake.${appName.toLowerCase().replace(/\s+/g, '')}`,
        pid,
        windows: [
          {
            title: appName,
            focused: true,
            tree: {
              role: 'window',
              name: appName,
              children: [{ role: 'staticText', name: 'Launched' }],
            },
          },
        ],
      }),
    )
    this.frontmostPid = pid
  }

  listAppsMeta(): Array<{
    app: string
    bundleId: string
    pid: number
    frontmost: boolean
  }> {
    return this.apps.map((a) => ({
      app: a.app,
      bundleId: a.bundleId,
      pid: a.pid,
      frontmost: a.pid === this.frontmostPid,
    }))
  }

  // ── private ──────────────────────────────────────────────

  private buildApp(spec: FakeAppSpec): LiveApp {
    return {
      app: spec.app,
      bundleId: spec.bundleId,
      pid: spec.pid,
      windows: spec.windows.map((w, i) => ({
        key: `${spec.pid}:${w.title}`,
        windowId: w.windowId,
        title: w.title,
        kind: w.kind ?? 'window',
        bounds: w.bounds ?? { x: 40 + i * 20, y: 40, width: 800, height: 600 },
        focused: w.focused ?? i === 0,
        visible: true,
        minimized: false,
        modal: w.modal ?? false,
        tree: this.buildElement(w.tree),
        topologyGen: 0,
      })),
    }
  }

  private buildElement(spec: FakeElementSpec): LiveElement {
    this.elementSeq += 1
    const id = `live-${this.elementSeq}`
    return {
      id,
      role: spec.role,
      name: spec.name,
      value: spec.value,
      bounds: spec.bounds ?? { x: 0, y: 0, width: 100, height: 24 },
      enabled: spec.enabled ?? true,
      focused: spec.focused ?? false,
      ignoreEvents: spec.ignoreEvents ?? false,
      opensModal: spec.opensModal,
      toggle: spec.toggle ?? false,
      children: (spec.children ?? []).map((c) => this.buildElement(c)),
    }
  }

  private toRootMeta(app: LiveApp, win: LiveWindow): Omit<UiRootIdentity, 'rootId'> {
    return {
      kind: win.kind,
      app: app.app,
      bundleId: app.bundleId,
      pid: app.pid,
      title: win.title,
      bounds: { ...win.bounds },
      focused: win.focused,
      visible: win.visible,
      minimized: win.minimized,
      modal: win.modal,
      resourceKey: `pid:${app.pid}`,
      ...(typeof win.windowId === 'number' ? { windowId: win.windowId } : {}),
    }
  }

  private resolveWindow(root: UiRootIdentity): { app: LiveApp; win: LiveWindow } {
    const app = this.apps.find((a) => a.pid === root.pid)
    if (!app) throw new Error(`fake: unknown pid ${root.pid}`)
    const win =
      (typeof root.windowId === 'number'
        ? app.windows.find((w) => w.windowId === root.windowId)
        : undefined)
      ?? app.windows.find((w) => w.title === root.title)
      ?? app.windows.find((w) => w.focused)
      ?? app.windows[0]
    if (!win) throw new Error(`fake: no window for ${root.app}`)
    return { app, win }
  }

  private toOutline(el: LiveElement): UiOutlineNode {
    if (!el.publicRef) {
      this.elementSeq += 1
      el.publicRef = `@e${this.elementSeq}`
    }
    const ref = el.publicRef
    const node: UiOutlineNode = {
      ref,
      role: el.role,
      name: el.name,
      value: el.value,
      bounds: { ...el.bounds },
      enabled: el.enabled,
      focused: el.focused,
      capabilities: {
        press: el.role === 'button' || el.role === 'checkbox' || el.toggle,
        setText: el.role === 'textField' || el.role === 'textArea',
        typeText: el.role === 'textField' || el.role === 'textArea',
        focus: true,
        scroll: el.role === 'scrollArea',
      },
    }
    if (el.children.length) {
      node.children = el.children.map((c) => this.toOutline(c))
    }
    return node
  }

  private findByRef(win: LiveWindow, ref: string): LiveElement | undefined {
    function walk(el: LiveElement): LiveElement | undefined {
      if (el.publicRef === ref) return el
      for (const c of el.children) {
        const hit = walk(c)
        if (hit) return hit
      }
      return undefined
    }
    return walk(win.tree)
  }

  private findLiveByName(
    pid: number,
    title: string,
    name: string,
  ): LiveElement | undefined {
    const app = this.apps.find((a) => a.pid === pid)
    const win = app?.windows.find((w) => w.title === title)
    if (!win) return undefined
    function walk(el: LiveElement): LiveElement | undefined {
      if (el.name === name) return el
      for (const c of el.children) {
        const hit = walk(c)
        if (hit) return hit
      }
      return undefined
    }
    return walk(win.tree)
  }

  private applyOne(
    app: LiveApp,
    win: LiveWindow,
    action: UiAction,
    focusRef: string | undefined,
    _delivery: string,
  ): PlatformActStepResult {
    if (this.silentDelivery) {
      return {
        applied: true,
        unknown: true,
        description: `${action.type}: silent delivery (no verification possible)`,
        focusRef,
      }
    }

    switch (action.type) {
      case 'press':
      case 'click': {
        const ref =
          action.type === 'press'
            ? action.ref
            : action.ref ?? focusRef
        if (!ref && action.type === 'click' && action.x != null && action.y != null) {
          // Coordinate click: hit-test by bounds.
          const hit = hitTest(win.tree, action.x, action.y)
          if (!hit) {
            return {
              applied: false,
              confirmedNoEffect: true,
              description: `click(${action.x},${action.y}): no target`,
              focusRef,
            }
          }
          return this.activate(app, win, hit, focusRef)
        }
        if (!ref) {
          return {
            applied: false,
            description: `${action.type}: missing ref`,
            focusRef,
          }
        }
        const el = this.findByRef(win, ref)
        if (!el) {
          return {
            applied: false,
            description: `${action.type}(${ref}): ref not found in current look`,
            focusRef,
          }
        }
        return this.activate(app, win, el, ref)
      }
      case 'setText': {
        const el = this.findByRef(win, action.ref)
        if (!el) {
          return { applied: false, description: `setText(${action.ref}): not found`, focusRef }
        }
        if (el.ignoreEvents) {
          return {
            applied: true,
            confirmedNoEffect: true,
            description: `setText(${action.ref}): ignored`,
            before: { value: el.value },
            after: { value: el.value },
            focusRef: action.ref,
          }
        }
        const before = el.value
        el.value = action.text
        el.focused = true
        return {
          applied: true,
          description: `setText(${action.ref})`,
          before: { value: before },
          after: { value: el.value },
          focusRef: action.ref,
        }
      }
      case 'typeText': {
        const ref = action.ref ?? focusRef
        if (!ref) {
          return { applied: false, description: 'typeText: no focus', focusRef }
        }
        const el = this.findByRef(win, ref)
        if (!el) {
          return { applied: false, description: `typeText(${ref}): not found`, focusRef }
        }
        if (el.ignoreEvents) {
          return {
            applied: true,
            confirmedNoEffect: true,
            description: `typeText(${ref}): ignored`,
            before: { value: el.value },
            after: { value: el.value },
            focusRef: ref,
          }
        }
        const before = el.value ?? ''
        el.value = before + action.text
        el.focused = true
        return {
          applied: true,
          description: `typeText(${ref})`,
          before: { value: before },
          after: { value: el.value },
          focusRef: ref,
        }
      }
      case 'keypress': {
        return {
          applied: true,
          description: `keypress(${action.keys.join('+')})`,
          focusRef,
        }
      }
      case 'scroll': {
        return {
          applied: true,
          description: `scroll(dx=${action.dx ?? 0}, dy=${action.dy ?? 0})`,
          focusRef: action.ref ?? focusRef,
        }
      }
      case 'drag': {
        return {
          applied: true,
          description: `drag(${action.path.length} points)`,
          focusRef,
        }
      }
      case 'moveMouse': {
        return {
          applied: true,
          unknown: true,
          description: `moveMouse(${action.x},${action.y})`,
          focusRef,
        }
      }
      default: {
        const _exhaustive: never = action
        return { applied: false, description: `unknown action: ${JSON.stringify(_exhaustive)}`, focusRef }
      }
    }
  }

  private activate(
    app: LiveApp,
    win: LiveWindow,
    el: LiveElement,
    focusRef: string | undefined,
  ): PlatformActStepResult {
    const ref = el.publicRef ?? focusRef
    if (el.ignoreEvents || !el.enabled) {
      return {
        applied: true,
        confirmedNoEffect: true,
        description: `activate(${el.name ?? ref}): ignored`,
        before: { name: el.name, value: el.value },
        after: { name: el.name, value: el.value },
        focusRef: ref,
      }
    }
    const before = { name: el.name, value: el.value }
    if (el.toggle) {
      el.value = el.value === 'on' ? 'off' : 'on'
    }
    if (el.opensModal) {
      const modalTitle = el.opensModal.title
      if (!app.windows.some((w) => w.title === modalTitle)) {
        app.windows.push({
          key: `${app.pid}:${modalTitle}`,
          title: modalTitle,
          kind: 'dialog',
          bounds: { x: 200, y: 160, width: 400, height: 240 },
          focused: true,
          visible: true,
          minimized: false,
          modal: true,
          topologyGen: 0,
          tree: this.buildElement({
            role: 'dialog',
            name: modalTitle,
            children: [
              { role: 'staticText', name: 'Confirm?' },
              { role: 'button', name: el.opensModal.buttonName },
            ],
          }),
        })
        win.focused = false
      }
    }
    el.focused = true
    return {
      applied: true,
      description: `activate(${el.name ?? ref})`,
      before,
      after: { name: el.name, value: el.value },
      focusRef: ref,
    }
  }
}

function hitTest(root: LiveElement, x: number, y: number): LiveElement | undefined {
  // Depth-first; last child wins (front-most approximation).
  let hit: LiveElement | undefined
  function walk(el: LiveElement): void {
    const b = el.bounds
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
      hit = el
    }
    for (const c of el.children) walk(c)
  }
  walk(root)
  return hit
}

function placeholderImage(label: string, space: CoordinateSpace): CapturedImage {
  return {
    mimeType: 'image/png',
    data: `fake-png:${label}`,
    width: space.width,
    height: space.height,
  }
}

/** Default world used by ComputerUseService when no adapter is injected. */
export function defaultWorld(): FakeAppSpec[] {
  return [
    {
      app: 'Notes',
      bundleId: 'com.apple.Notes',
      pid: 1001,
      windows: [
        {
          title: 'Notes',
          focused: true,
          tree: {
            role: 'window',
            name: 'Notes',
            children: [
              {
                role: 'group',
                name: 'Sidebar',
                children: [
                  { role: 'button', name: 'New Note' },
                  { role: 'list', name: 'Folders', children: [
                    { role: 'cell', name: 'All iCloud' },
                    { role: 'cell', name: 'Work' },
                  ] },
                ],
              },
              {
                role: 'group',
                name: 'Editor',
                children: [
                  {
                    role: 'textField',
                    name: 'Title',
                    value: '',
                    bounds: { x: 300, y: 80, width: 400, height: 28 },
                  },
                  {
                    role: 'textArea',
                    name: 'Body',
                    value: '',
                    bounds: { x: 300, y: 120, width: 500, height: 400 },
                  },
                  {
                    role: 'button',
                    name: 'Save',
                    bounds: { x: 700, y: 540, width: 80, height: 28 },
                  },
                  {
                    role: 'button',
                    name: 'Broken',
                    ignoreEvents: true,
                    bounds: { x: 600, y: 540, width: 80, height: 28 },
                  },
                  {
                    role: 'button',
                    name: 'Share…',
                    opensModal: { title: 'Share Note', buttonName: 'Send' },
                    bounds: { x: 500, y: 540, width: 80, height: 28 },
                  },
                ],
              },
            ],
          },
        },
      ],
    },
    {
      app: 'System Settings',
      bundleId: 'com.apple.systempreferences',
      pid: 1002,
      windows: [
        {
          title: 'System Settings',
          focused: false,
          tree: {
            role: 'window',
            name: 'System Settings',
            children: [
              {
                role: 'group',
                name: 'Sidebar',
                children: [deepSettingsTree()],
              },
              {
                role: 'checkbox',
                name: 'Dark Mode',
                value: 'off',
                toggle: true,
                bounds: { x: 400, y: 200, width: 120, height: 24 },
              },
            ],
          },
        },
      ],
    },
  ]
}

function deepSettingsTree(): FakeElementSpec {
  // Deep tree so fold truncates and query/expand are meaningful.
  return {
    role: 'list',
    name: 'Categories',
    children: [
      {
        role: 'cell',
        name: 'General',
        children: [
          {
            role: 'group',
            name: 'General Pane',
            children: [
              { role: 'staticText', name: 'About' },
              { role: 'staticText', name: 'Software Update' },
              {
                role: 'group',
                name: 'Storage',
                children: [
                  { role: 'staticText', name: 'Applications' },
                  { role: 'staticText', name: 'Documents' },
                  { role: 'button', name: 'Manage…' },
                ],
              },
            ],
          },
        ],
      },
      { role: 'cell', name: 'Network' },
      { role: 'cell', name: 'Privacy & Security' },
    ],
  }
}
