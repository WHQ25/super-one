import { describe, expect, it } from 'vitest'
import { decodeXmlEntities, parseXml } from './ui-xml'

describe('parseXml on a uiautomator dump', () => {
  it('reads the hierarchy root and its attributes', () => {
    const root = parseXml(
      '<?xml version=\'1.0\' encoding=\'UTF-8\' standalone=\'yes\' ?>'
      + '<hierarchy rotation="0"><node index="0" class="android.widget.FrameLayout" /></hierarchy>',
    )
    expect(root?.name).toBe('hierarchy')
    expect(root?.attributes.rotation).toBe('0')
    expect(root?.children).toHaveLength(1)
  })

  it('nests children to the depth the dump actually has', () => {
    const root = parseXml('<a><b><c /></b><d /></a>')
    expect(root?.children.map((child) => child.name)).toEqual(['b', 'd'])
    expect(root?.children[0]?.children.map((child) => child.name)).toEqual(['c'])
  })

  it('handles both self-closing and paired elements in one document', () => {
    const root = parseXml('<a><b /><c></c></a>')
    expect(root?.children).toHaveLength(2)
    expect(root?.children.every((child) => child.children.length === 0)).toBe(true)
  })
})

describe('attribute values that contain XML metacharacters', () => {
  it('keeps a label containing a greater-than sign intact', () => {
    // The reason this is a scanner and not a regex. `<node[^>]*>` truncates here and
    // produces a silently wrong tree — no exception, just a missing subtree.
    const root = parseXml('<node text="Speed > 50" class="android.widget.TextView" />')
    expect(root?.attributes.text).toBe('Speed > 50')
    expect(root?.attributes.class).toBe('android.widget.TextView')
  })

  it('does not treat a slash-bracket inside a label as the end of the element', () => {
    // A real button could read "50/> off". Nothing about it is malformed XML.
    const root = parseXml('<hierarchy><node text="50/> off" /><node text="second" /></hierarchy>')
    expect(root?.children.map((child) => child.attributes.text)).toEqual(['50/> off', 'second'])
  })

  it('keeps a label containing a less-than sign, which arrives escaped', () => {
    const root = parseXml('<node text="a &lt; b" />')
    expect(root?.attributes.text).toBe('a < b')
  })

  it('parses bounds, whose brackets are not markup', () => {
    const root = parseXml('<node bounds="[0,0][1080,2400]" />')
    expect(root?.attributes.bounds).toBe('[0,0][1080,2400]')
  })
})

describe('decodeXmlEntities', () => {
  it('resolves the ampersand any real UI label runs into', () => {
    // "Terms & Conditions" on a button is entirely ordinary, and it always arrives
    // escaped — an agent searching for the literal text would otherwise never match.
    expect(decodeXmlEntities('Terms &amp; Conditions')).toBe('Terms & Conditions')
  })

  it('resolves the rest of the predefined set', () => {
    expect(decodeXmlEntities('&lt;&gt;&quot;&apos;')).toBe('<>"\'')
  })

  it('resolves numeric references, decimal and hex', () => {
    expect(decodeXmlEntities('&#65;&#x4e2d;')).toBe('A中')
  })

  it('leaves something that only looks like an entity alone', () => {
    expect(decodeXmlEntities('100 &widgets; later')).toBe('100 &widgets; later')
  })

  it('returns the string untouched when there is nothing to decode', () => {
    const plain = 'Settings'
    expect(decodeXmlEntities(plain)).toBe(plain)
  })
})

describe('parseXml on input it cannot fully read', () => {
  it('answers null for a document with no element', () => {
    expect(parseXml('')).toBeNull()
    expect(parseXml('<?xml version="1.0" ?>')).toBeNull()
  })

  it('returns the partial tree from a dump that was cut short', () => {
    // A truncated dump is more useful than an exception: the caller can see the root
    // has no children and fall back, which it cannot do from a thrown error.
    const root = parseXml('<hierarchy><node text="visible" /><node text="cut')
    expect(root?.name).toBe('hierarchy')
    expect(root?.children[0]?.attributes.text).toBe('visible')
  })

  it('terminates on malformed markup instead of spinning', () => {
    expect(() => parseXml('<a =!! ><b/></a>')).not.toThrow()
  })
})
