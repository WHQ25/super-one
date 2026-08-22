import { describe, expect, it } from 'vitest'
import type { DeviceUiNode } from '@superone/shared/device-agent'
import { collectNodes, findNode, hasUsableSemantics } from '../tree'
import { ANDROID_LAUNCHER_DUMP } from '../../../test/fixtures/android-uiautomator'
import {
  orientationForRotation,
  parseBounds,
  roleForClass,
  stripDumpTrailer,
  uiautomatorToTree,
} from './uiautomator'

const SCREEN = { width: 1080, height: 2400 }

function tree(): DeviceUiNode {
  const dump = uiautomatorToTree(ANDROID_LAUNCHER_DUMP, { screen: SCREEN })
  if (!dump) throw new Error('the real launcher dump failed to parse')
  return dump.tree.root
}

function byLabel(label: string): DeviceUiNode | undefined {
  return findNode(tree(), (node) => node.label === label)
}

describe('reading a real launcher dump', () => {
  it('parses the dump this machine produced, trailer and all', () => {
    const dump = uiautomatorToTree(ANDROID_LAUNCHER_DUMP, { screen: SCREEN })
    expect(dump?.orientation).toBe('portrait')
    expect(dump?.screen).toEqual(SCREEN)
    expect(dump?.truncated).toBe(false)
  })

  it('produces a tree the shared semantics check calls usable', () => {
    // The gate the backend uses to decide between the app's own tree and reading
    // pixels. If this ever answers false, every Android snapshot silently degrades.
    expect(hasUsableSemantics(tree())).toBe(true)
  })

  it('recovers the screen size from the root when none is given', () => {
    const dump = uiautomatorToTree(ANDROID_LAUNCHER_DUMP)
    expect(dump?.screen).toEqual(SCREEN)
  })

  it('finds the home-screen icons a person would name', () => {
    for (const app of ['Chrome', 'Gmail', 'Phone', 'Messages']) {
      expect(byLabel(app), app).toBeDefined()
    }
  })
})

describe('an app icon, which Android builds out of a TextView', () => {
  it('is a button, because it is clickable', () => {
    // Every icon on the Android home screen is `android.widget.TextView` with
    // clickable="true". Mapping by class alone would hand the agent
    // `{role: 'text', label: 'Chrome'}` — a caption it has no reason to press — while
    // the same icon on iOS is an AXButton. That divergence is the bug this prevents.
    expect(byLabel('Chrome')?.role).toBe('button')
  })

  it('keeps a plain caption a caption', () => {
    expect(roleForClass('android.widget.TextView')).toBe('text')
    expect(roleForClass('android.widget.TextView', true)).toBe('button')
  })

  it('does not promote something that already says what it is', () => {
    expect(roleForClass('android.widget.EditText', true)).toBe('textfield')
    expect(roleForClass('androidx.recyclerview.widget.RecyclerView', true)).toBe('list')
  })

  it('names an unmapped custom view after itself rather than giving up', () => {
    expect(roleForClass('com.app.ChartView')).toBe('chartview')
  })
})

describe('label and value, when an app writes both', () => {
  it('keeps the description and the face text when they differ', () => {
    // Verbatim from the fixture: the Play Store icon reads "Play Store" but is
    // described as "Play Store has 1 notification". The count exists only in the
    // description and the app name only in the text, so dropping either loses a way
    // to find it.
    const node = findNode(tree(), (candidate) => candidate.value === 'Play Store')
    expect(node?.label).toBe('Play Store has 1 notification')
  })

  it('does not repeat itself when the two agree', () => {
    const node = byLabel('Gmail')
    expect(node?.value).toBeUndefined()
  })

  it('prefers the description, which is what a screen reader would say', () => {
    expect(byLabel('Google Lens')).toBeDefined()
  })
})

describe('identifiers', () => {
  it('keeps the package half, which is what separates a system id from the app\'s', () => {
    const node = findNode(
      tree(),
      (candidate) => candidate.identifier?.endsWith(':id/lens_icon') === true,
    )
    expect(node?.identifier).toBe('com.google.android.apps.nexuslauncher:id/lens_icon')
  })
})

describe('bounds', () => {
  it('converts pixels into framebuffer ratios', () => {
    // Google Lens sits at [865,2125][991,2290] on a 1080x2400 screen.
    const node = findNode(
      tree(),
      (candidate) => candidate.identifier?.endsWith(':id/lens_icon') === true,
    )
    // [x, y, width, height] as fractions, rounded to four places the way the iOS
    // backend rounds its own — same precision on both platforms so a bounds-derived
    // tap lands in the same place.
    expect(node?.bounds).toEqual([0.8009, 0.8854, 0.1167, 0.0688])
  })

  it('reads the bracket pair uiautomator writes', () => {
    expect(parseBounds('[0,0][1080,2400]')).toEqual({
      left: 0, top: 0, right: 1080, bottom: 2400,
    })
  })

  it('reads a negative origin, which an off-screen view really has', () => {
    expect(parseBounds('[-40,10][0,50]')).toMatchObject({ left: -40 })
  })

  it('declines anything that is not that shape', () => {
    expect(parseBounds('0,0,1080,2400')).toBeNull()
    expect(parseBounds('')).toBeNull()
  })
})

describe('the node budget', () => {
  it('stops at the ceiling and says how much it dropped', () => {
    const dump = uiautomatorToTree(ANDROID_LAUNCHER_DUMP, { screen: SCREEN, maxNodes: 10 })
    expect(collectNodes(dump!.tree.root)).toHaveLength(10)
    expect(dump?.truncated).toBe(true)
    expect(dump?.tree.root.truncatedChildren).toBeGreaterThan(0)
  })

  it('leaves a complete tree unmarked', () => {
    const dump = uiautomatorToTree(ANDROID_LAUNCHER_DUMP, { screen: SCREEN, maxNodes: 5000 })
    expect(dump?.tree.root.truncatedChildren).toBeUndefined()
  })
})

describe('stripDumpTrailer', () => {
  it('removes the line uiautomator appends, typo included', () => {
    // Android has emitted "hierchary" since the beginning; matching the correct
    // spelling matches nothing and leaves the XML unparseable.
    const stripped = stripDumpTrailer('<hierarchy /># UI hierchary dumped to: /dev/tty')
    expect(stripped).toBe('<hierarchy />#')
  })

  it('leaves output that has no trailer alone', () => {
    expect(stripDumpTrailer('<hierarchy />')).toBe('<hierarchy />')
  })
})

describe('orientationForRotation', () => {
  it('maps the Surface constants onto the shared vocabulary', () => {
    expect([0, 1, 2, 3].map(orientationForRotation)).toEqual([
      'portrait', 'landscape-left', 'portrait-upside-down', 'landscape-right',
    ])
  })

  it('agrees with the shared landscape test on both quarter turns', () => {
    // The only question anything downstream actually asks. Which of the two landscapes
    // an odd value names is a direct reading of the constant order and carries no
    // coordinate transform here — scrcpy hands over an already-rotated framebuffer.
    expect(orientationForRotation(1)).toMatch(/landscape/)
    expect(orientationForRotation(3)).toMatch(/landscape/)
  })

  it('treats a rotation it cannot read as upright', () => {
    expect(orientationForRotation(Number.NaN)).toBe('portrait')
  })
})

describe('input the dump cannot come back from', () => {
  it('answers null rather than an empty tree when there is no XML', () => {
    // The backend has to be able to tell "nothing to read" from "a blank screen".
    expect(uiautomatorToTree('')).toBeNull()
    expect(uiautomatorToTree('ERROR: could not get idle state.')).toBeNull()
  })

  it('answers null when no screen size can be established', () => {
    expect(uiautomatorToTree('<hierarchy rotation="0"><node class="X" /></hierarchy>')).toBeNull()
  })
})
