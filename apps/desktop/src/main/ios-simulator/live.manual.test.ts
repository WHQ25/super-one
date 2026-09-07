/**
 * Checks that only a real simulator can answer, opted into with `IOS_LIVE=1`.
 *
 * The counterpart to `device/android/live.manual.test.ts`, and it exists for the same
 * reason: text entry has two premises that cannot be established from source. Whether
 * `AXValue` reports a placeholder, and whether writing `AXValue` reaches the app's own
 * state rather than only its pixels, are facts about UIKit and about AXPTranslator —
 * and a unit test can only assume them.
 *
 * ```bash
 * xcrun simctl boot <udid>
 * IOS_LIVE=1 IOS_LIVE_UDID=<udid> bunx vitest run src/main/ios-simulator/live.manual.test.ts
 * ```
 *
 * The helper is compiled on demand from `native/ios-simulator-helper/Sources`, so the
 * first run after a change to it pays a one-off Swift build.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { IosSimulatorManager } from './ios-simulator-manager'
import { createIosSimulatorHelperRuntime, probeIosSimulatorHelper } from './helper-client'
import { normalizeAccessibilityTree, type IosSimulatorRawNode } from './a11y-tree'
import { collectNodes } from '../device/tree'

const live = process.env.IOS_LIVE === '1'
const udid = process.env.IOS_LIVE_UDID ?? ''

function report(...parts: unknown[]): void {
  const line = parts
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
    .join(' ')
  const target = process.env.IOS_LIVE_REPORT
  if (target) writeFileSync(target, line + '\n', { flag: 'a' })
}

function manager(): IosSimulatorManager {
  const cacheRoot = join(tmpdir(), 'superone-ios-live-helper')
  return new IosSimulatorManager({
    captureRoot: join(tmpdir(), 'superone-ios-live-captures'),
    helperProbe: () => probeIosSimulatorHelper(cacheRoot),
    nativeFactory: () => createIosSimulatorHelperRuntime(cacheRoot),
  })
}

/** Every node in the raw dump, so a probe can look at attributes the tree drops. */
function rawNodes(node: IosSimulatorRawNode): IosSimulatorRawNode[] {
  return [node, ...(node.children ?? []).flatMap(rawNodes)]
}

/**
 * Put the caret in the first text field on screen, so the run is repeatable.
 *
 * Tapped rather than assumed: the screen a simulator happens to be showing is not
 * something a test may rely on, and a probe that silently proves nothing because
 * nothing had focus is worse than one that says so.
 */
async function focusField(ios: IosSimulatorManager): Promise<IosSimulatorRawNode | null> {
  const dump = await ios.accessibilityDump(udid)
  const tree = normalizeAccessibilityTree(dump, 'portrait')
  const raw = rawNodes(dump.tree)
  const index = raw.findIndex((node) => node.placeholder || node.role === 'AXTextField')
  if (index < 0) return null
  // Refs are assigned in the same traversal order `rawNodes` walks, so the two line up.
  const bounds = collectNodes(tree.root)[index]?.bounds
  if (!bounds) return null
  const [x, y, width, height] = bounds
  await ios.input(udid, { type: 'tap', xRatio: x + width / 2, yRatio: y + height / 2 })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const after = rawNodes((await ios.accessibilityDump(udid)).tree)
  return after.find((node) => node.focused) ?? null
}

describe.skipIf(!live)('entering text into a real simulator', () => {
  it('reports a placeholder as a placeholder, not as a value somebody typed', async () => {
    const ios = manager()
    await ios.bind('live-ios', udid)
    // Focused first: an unfocused field is drawn but not always described, and a probe
    // that finds nothing proves nothing.
    await focusField(ios)
    const dump = await ios.accessibilityDump(udid)

    // The premise behind the whole placeholder fix: an empty UITextField answers
    // AXValue with its placeholder, which is how a search box nobody had typed in came
    // back as `value: "Search all sessions…"`.
    const fields = rawNodes(dump.tree).filter((node) => node.placeholder)
    report(`fields with a placeholder: ${fields.length}`)
    for (const field of fields.slice(0, 4)) {
      report(`  role=${field.role} value=${JSON.stringify(field.value)} `
        + `placeholder=${JSON.stringify(field.placeholder)}`)
    }
    // A run with no text field on screen proves nothing either way; say so rather
    // than passing quietly.
    if (fields.length === 0) {
      report('  no placeholdered field on screen — open one and re-run')
      return
    }
    // AXPlaceholderValue reaching us at all is the half that could not be read from
    // source: without it the guard in `insertText` can never fire.
    expect(fields[0]!.placeholder).toBeTruthy()

    const tree = normalizeAccessibilityTree(dump, 'portrait')
    const empty = rawNodes(dump.tree).find((node) => node.value === node.placeholder && node.value)
    if (empty) {
      const shown = [...tree.refs.keys()]
      report(`an empty field reports value === placeholder; refs=${shown.length}`)
    }
    await ios.releaseDevice(udid)
  }, 300_000)

  it('puts text in the focused field and lets the app see it', async () => {
    const ios = manager()
    await ios.bind('live-ios', udid)

    const focused = await focusField(ios)
    report(`focused: role=${focused?.role} value=${JSON.stringify(focused?.value)} `
      + `placeholder=${JSON.stringify(focused?.placeholder)}`)
    if (!focused) {
      report('no text field on screen — open one and re-run')
      return
    }

    // Started from empty rather than from whatever the last run left behind.
    await ios.input(udid, { type: 'insertText', text: '', replace: true })
    const typed = await ios.enterText(udid, 'check')
    report(`enterText -> ${JSON.stringify(typed)}`)
    expect(typed.ok).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 1200))
    const value = async () => rawNodes((await ios.accessibilityDump(udid)).tree)
      .find((node) => node.focused)?.value
    report(`after "check": ${JSON.stringify(await value())}`)
    // The regression: five ASCII characters used to go out as HID usage codes, which
    // the guest's input method composes. On a simulator set to Pinyin, `check`
    // arrived as `chee c k`.
    expect(await value()).toBe('check')

    // `type` inserts, it does not replace — which is the whole reason `setText` had to
    // exist. Pinned here because it is the difference an agent has to know about.
    await ios.enterText(udid, '-audit')
    await new Promise((resolve) => setTimeout(resolve, 800))
    report(`after "-audit": ${JSON.stringify(await value())}`)
    expect(await value()).toBe('check-audit')
    await ios.input(udid, { type: 'insertText', text: '', replace: true })

    await ios.releaseDevice(udid)
  }, 300_000)

  it('reaches the app\'s own state, not just the pixels it draws', async () => {
    // The gate this whole approach rests on. A React Native TextInput is a CONTROLLED
    // component: its JS state updates from UIControlEventEditingChanged, which UIKit
    // does not send when `text` is set programmatically. If writing AXValue only moved
    // the pixels, the field would show the text and the app would never know — and the
    // next render would wipe it.
    //
    // Run against the mobile app's preview screen, which draws "N matching scenarios"
    // from the same state its TextInput feeds. If that count moves, JS saw the text.
    const ios = manager()
    await ios.bind('live-ios', udid)

    const count = () => ios.accessibilityDump(udid).then((dump) => rawNodes(dump.tree)
      .map((node) => node.label ?? node.value ?? '')
      .find((text) => text.includes('matching')))

    const focused = await focusField(ios)
    if (!focused) { report('no text field on screen — open the preview screen and re-run'); return }
    await ios.input(udid, { type: 'insertText', text: '', replace: true })
    await new Promise((resolve) => setTimeout(resolve, 800))
    const before = await count()
    report(`before: ${JSON.stringify(before)}`)
    if (!before) { report('no "N matching" counter on screen — open the preview screen'); return }

    const typed = await ios.enterText(udid, 'sandbox')
    expect(typed.ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const after = await count()
    report(`after typing "sandbox": ${JSON.stringify(after)}`)
    expect(after).not.toBe(before)

    await ios.input(udid, { type: 'insertText', text: '', replace: true })
    await ios.releaseDevice(udid)
  }, 300_000)

  it('replaces a field with setText and clears it with an empty one', async () => {
    const ios = manager()
    await ios.bind('live-ios', udid)

    await focusField(ios)
    const replaced = await ios.input(udid, { type: 'insertText', text: 'theme', replace: true })
    report(`setText -> ${JSON.stringify(replaced)}`)
    expect(replaced.ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 800))
    let field = rawNodes((await ios.accessibilityDump(udid)).tree).find((node) => node.focused)
    report(`after setText: ${JSON.stringify(field?.value)}`)
    expect(field?.value).toBe('theme')

    const cleared = await ios.input(udid, { type: 'insertText', text: '', replace: true })
    expect(cleared.ok).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 800))
    const dump = await ios.accessibilityDump(udid)
    field = rawNodes(dump.tree).find((node) => node.focused)
    report(`after clear: value=${JSON.stringify(field?.value)} `
      + `placeholder=${JSON.stringify(field?.placeholder)}`)
    // Cleared means empty, and an empty field must not read back as its own prompt.
    expect(field?.value === undefined || field.value === field.placeholder).toBe(true)

    await ios.releaseDevice(udid)
  }, 300_000)

  it('sends a trailing Return as a key, not as a newline in the value', async () => {
    const ios = manager()
    await ios.bind('live-ios', udid)
    const focused = await focusField(ios)
    const placeholder = focused?.placeholder
    if (!placeholder) { report('no placeholdered field on screen'); return }
    await ios.input(udid, { type: 'insertText', text: '', replace: true })

    const result = await ios.enterText(udid, 'audit\n')
    report(`enterText with Return -> ${JSON.stringify(result)}`)
    expect(result.ok).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 1200))
    // Found by placeholder, not by focus: Return may dismiss the keyboard, and
    // "whatever has focus now" would then be a different node with nothing to say.
    const field = rawNodes((await ios.accessibilityDump(udid)).tree)
      .find((node) => node.placeholder === placeholder)
    report(`after "audit\\n": value=${JSON.stringify(field?.value)}`)
    expect(field?.value).toBe('audit')
    // Written into the value a Return is a newline character and the app's submit
    // handler never runs. Splitting it out is what keeps the keystroke a keystroke —
    // and what proves the two channels did not arrive out of order.
    expect(field?.value ?? '').not.toContain('\n')

    await ios.releaseDevice(udid)
  }, 300_000)

  it('says what to do when nothing is focused, instead of typing into nowhere', async () => {
    const ios = manager()
    await ios.bind('live-ios', udid)
    // The home screen focuses nothing, so this is the unfocused case on purpose.
    await ios.input(udid, { type: 'button', button: 'home' })
    await new Promise((resolve) => setTimeout(resolve, 1500))

    const result = await ios.enterText(udid, 'check')
    report(`enterText with nothing focused -> ${JSON.stringify(result)}`)
    // HID accepts keystrokes with nothing focused, so falling back would have reported
    // success while the text went nowhere.
    expect(result.ok).toBe(false)
    expect(result.error).toContain('focused')

    await ios.releaseDevice(udid)
  }, 300_000)
})
