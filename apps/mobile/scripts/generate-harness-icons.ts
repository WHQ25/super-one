import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import postcss from 'postcss'
import { ClaudeSessionIcon, type SessionIconProps } from '../../../packages/ui/src/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '../../../packages/ui/src/components/harness/CodexSessionIcon'
import { AcpSessionIcon } from '../../../packages/ui/src/components/harness/AcpSessionIcon'
import { GrokSessionIcon } from '../../../packages/ui/src/components/harness/GrokSessionIcon'
import { CursorSessionIcon } from '../../../packages/ui/src/components/harness/CursorSessionIcon'
import { OpenCodeSessionIcon } from '../../../packages/ui/src/components/harness/OpenCodeSessionIcon'
import { DeepseekSessionIcon } from '../../../packages/ui/src/components/harness/DeepseekSessionIcon'
import type { HarnessSceneData, IconBrand, IconMotion, IconScene, MotionFrame, SceneStyle } from '../src/ui/harness-scene-types'

type Element = NonNullable<ReturnType<DOMParser['parseFromString']>['documentElement']>

const root = resolve(import.meta.dirname, '../../..')
const css = postcss.parse(readFileSync(resolve(root, 'packages/ui/src/styles/theme.css'), 'utf8'))
const styles: Record<string, Record<string, string>> = {}
const frames: Record<string, MotionFrame[]> = {}
const motions: Record<string, IconMotion> = {}
css.walkAtRules('keyframes', (rule) => {
  if (!/^(claude|codex|harness)-session-/.test(rule.params)) return
  const points: MotionFrame[] = []
  rule.walkRules((frame) => {
    const values: Omit<MotionFrame, 'at'> = {}
    frame.walkDecls((decl) => {
      if (decl.prop === 'opacity') values.opacity = Number(decl.value)
      if (decl.prop === 'transform') values.transform = decl.value
    })
    for (const position of frame.selector.split(',')) {
      const at = position.trim() === 'from' ? 0 : position.trim() === 'to' ? 1 : parseFloat(position) / 100
      points.push({ at, ...values })
    }
  })
  frames[rule.params] = points.sort((a, b) => a.at - b.at)
})
css.walkRules((rule) => {
  if (!/^\.(claude|codex|harness)-session-[\w-]+$/.test(rule.selector)) return
  // Reduced-motion is handled by the native accessibility setting at runtime.
  if (rule.parent?.type !== 'root') return
  const declarations: Record<string, string> = {}
  rule.walkDecls((decl) => { declarations[decl.prop] = decl.value })
  styles[rule.selector.slice(1)] = declarations
  for (const animation of declarations.animation?.split(',') ?? []) {
    const [name, seconds, easing] = animation.trim().split(/\s+/)
    if (!name || !seconds || !frames[name]) throw new Error(`Unsupported animation: ${animation}`)
    motions[name] = { duration: parseFloat(seconds) * 1000, easing: easing ?? 'linear', frames: frames[name]! }
  }
})
const serializer = new XMLSerializer()
const elements = (node: Element): Element[] => Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1)
const classes = (node: Element) => (node.getAttribute('class') ?? '').split(/\s+/)
function declarations(node: Element) {
  const result: Record<string, string> = {}
  for (const name of classes(node)) Object.assign(result, styles[name])
  for (const item of (node.getAttribute('style') ?? '').split(';')) {
    const colon = item.indexOf(':')
    if (colon !== -1) result[item.slice(0, colon).trim()] = item.slice(colon + 1).trim()
  }
  return result
}
const animations = (node: Element) => (declarations(node).animation ?? '').split(',').filter(Boolean).map((item) => item.trim().split(/\s+/)[0]!)
function nativeStyle(node: Element): SceneStyle {
  const style: SceneStyle = { alignItems: 'center', justifyContent: 'center' }
  const allowed = new Set(['width', 'height', 'left', 'right', 'top', 'bottom', 'position', 'opacity', 'background', 'border-radius', 'transform-origin'])
  for (const [key, raw] of Object.entries(declarations(node))) {
    if (key === 'inset') { Object.assign(style, { top: 0, left: 0, right: 0, bottom: 0 }); continue }
    if (!allowed.has(key)) continue
    const name = key === 'background' ? 'backgroundColor' : key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    style[name] = raw.includes('var(') ? '$background' : raw === '50%' && key === 'border-radius' ? 999 : /^-?[\d.]+(?:px)?$/.test(raw) ? parseFloat(raw) : raw
  }
  return style
}

function scene(node: Element, corner = false): IconScene {
  const names = classes(node)
  const badge = names.includes('harness-session-corner')
  const result: IconScene = { style: nativeStyle(node), animations: animations(node) }
  if (node.tagName === 'svg') {
    if (corner) Object.assign(result.style, { width: 9, height: 9 })
    const defs = elements(node).filter((child) => child.tagName === 'defs')
    const parts = elements(node).filter((child) => child.tagName !== 'defs' && child.tagName !== 'title')
    result.children = parts.map((part) => {
      const shell = node.cloneNode(false) as Element
      for (const attr of ['class', 'style', 'width', 'height', 'aria-hidden']) shell.removeAttribute(attr)
      if (corner) {
        for (const [key, value] of Object.entries({ stroke: 'currentColor', fill: 'none', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) shell.setAttribute(key, value)
      }
      for (const def of defs) shell.appendChild(def.cloneNode(true))
      shell.appendChild(part.cloneNode(true))
      return { style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }, animations: animations(part), xml: serializer.serializeToString(shell) }
    })
  } else {
    if (badge) result.style.color = names.includes('harness-session-corner-check') ? styles['harness-session-corner-check']!.color! : styles['harness-session-corner-clock']!.color!
    result.children = elements(node).map((child) => scene(child, badge))
  }
  return result
}

// Render twice to retain desktop's size-dependent layout without duplicating its
// leg, key or SVG formulas in the native renderer.
function scaleLayout(a: IconScene, b: IconScene) {
  for (const key of Object.keys(a.style)) {
    const small = a.style[key], large = b.style[key]
    if (typeof small === 'number' && typeof large === 'number' && small !== large) {
      const multiplier = (large - small) / 26
      a.style[key] = { multiplier, offset: small - multiplier * 26 }
    }
  }
  if (a.children?.length !== b.children?.length) throw new Error('Size changes the desktop icon structure')
  a.children?.forEach((child, index) => scaleLayout(child, b.children![index]!))
}
const components: Record<IconBrand, ComponentType<SessionIconProps>> = {
  claude: ClaudeSessionIcon, codex: CodexSessionIcon, acp: AcpSessionIcon,
  grok: GrokSessionIcon, cursor: CursorSessionIcon, opencode: OpenCodeSessionIcon, dsh: DeepseekSessionIcon,
}
const scenes = {} as HarnessSceneData['scenes']
for (const [brand, Component] of Object.entries(components)) {
  const states = {} as HarnessSceneData['scenes'][IconBrand]
  for (const status of ['default', 'running', 'background', 'unseen', 'automation'] as const) {
    states[status] = {} as typeof states[typeof status]
    for (const renderLevel of ['compact', 'rich'] as const) {
      const render = (size: number) => {
        const markup = renderToStaticMarkup(createElement(Component, { status, renderLevel, size }))
        const document = new DOMParser().parseFromString(markup, 'text/xml')
        if (!document.documentElement) throw new Error(`Missing artwork: ${brand}/${status}`)
        return scene(document.documentElement)
      }
      const small = render(26)
      scaleLayout(small, render(52))
      states[status][renderLevel] = small
    }
  }
  scenes[brand as IconBrand] = states
}
const output = `${JSON.stringify({ scenes, motions })}\n`
const target = resolve(root, 'apps/mobile/src/ui/harness-scenes.generated.json')
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Harness icons are stale. Run generate-harness-icons.ts')
} else writeFileSync(target, output)
console.log(`Harness scenes: ${Object.keys(scenes).length} brands × 5 states × 2 detail levels; ${Object.keys(motions).length} desktop animations`)
