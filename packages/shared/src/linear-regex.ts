/**
 * A linear-time matcher for untrusted regular expressions, such as a server's
 * JSON Schema `pattern`. A backtracking engine can be made to run for minutes by
 * a pattern like `^(a+)+$`; this one simulates the pattern's NFA (a Pike VM), so
 * a test costs O(input length × pattern size) whatever the pattern.
 *
 * It accepts ECMAScript `u`-mode syntax without backreferences and lookaround,
 * which no linear engine can provide. Single-character atoms (classes, escapes,
 * `.`) are delegated to the native engine one code point at a time, which keeps
 * their full semantics and cannot backtrack. Test semantics match
 * `new RegExp(pattern, 'u').test(input)`: unanchored, no flags.
 */

/** Upper bound on compiled NFA instructions; `a{1000}{1000}` stays bounded. */
const MAX_INSTRUCTIONS = 10_000

export class UnsupportedPattern extends Error {}

type Node =
  | { t: 'atom'; test: (cp: number) => boolean }
  | { t: 'seq'; items: Node[] }
  | { t: 'alt'; options: Node[] }
  | { t: 'rep'; node: Node; min: number; max: number }
  | { t: 'assert'; kind: 'start' | 'end' | 'word' | 'nonword' }

type Inst =
  | { op: 'atom'; test: (cp: number) => boolean }
  | { op: 'split'; x: number; y: number }
  | { op: 'jmp'; x: number }
  | { op: 'assert'; kind: 'start' | 'end' | 'word' | 'nonword' }
  | { op: 'match' }

/**
 * Exactly one construct that matches a single code point: `.`, one class, or one
 * escape. Groups, alternation, quantifiers and anchors can only appear inside a
 * class, where they are literal. Linear by construction: each alternative starts
 * with a different character.
 */
const SINGLE_CODE_POINT_ATOM = /^(?:\.|\[(?:[^\\\]]|\\[^])*\]|\\(?:[dDwWsSfnrtv0]|[pP]\{[A-Za-z0-9_=]+\}|u\{[0-9a-fA-F]+\}|u[dD][89abAB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|c[A-Za-z]|[$()*+./?[\\\]^{|}-]))$/

/**
 * The only path to the native engine. Anything but one single-code-point atom
 * would bring backtracking back, so a slice that fails the check is unsupported,
 * never matched natively.
 */
export function assertSingleCodePointAtom(source: string): void {
  if (!SINGLE_CODE_POINT_ATOM.test(source)) throw new UnsupportedPattern('an unexpected atom')
}

function nativeAtom(source: string): (cp: number) => boolean {
  assertSingleCodePointAtom(source)
  const re = new RegExp(`^(?:${source})$`, 'u')
  return (cp) => re.test(String.fromCodePoint(cp))
}

class Parser {
  private i = 0
  constructor(private readonly src: string) {}

  parse(): Node {
    const node = this.alternation()
    if (this.i < this.src.length) throw new UnsupportedPattern(`unexpected "${this.src[this.i]}"`)
    return node
  }

  private peek(): string | undefined {
    return this.src[this.i]
  }

  private alternation(): Node {
    const options = [this.sequence()]
    while (this.peek() === '|') {
      this.i++
      options.push(this.sequence())
    }
    return options.length === 1 ? options[0]! : { t: 'alt', options }
  }

  private sequence(): Node {
    const items: Node[] = []
    while (this.i < this.src.length && this.peek() !== '|' && this.peek() !== ')') {
      items.push(this.quantified(this.atom()))
    }
    return items.length === 1 ? items[0]! : { t: 'seq', items }
  }

  private quantified(node: Node): Node {
    const c = this.peek()
    let min: number
    let max: number
    if (c === '*') { min = 0; max = Infinity; this.i++ }
    else if (c === '+') { min = 1; max = Infinity; this.i++ }
    else if (c === '?') { min = 0; max = 1; this.i++ }
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(this.src.slice(this.i))
      if (!m) return node
      min = Number(m[1])
      max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3])
      this.i += m[0].length
    } else {
      return node
    }
    // Lazy and greedy quantifiers accept the same strings; only `test` is needed.
    if (this.peek() === '?') this.i++
    // A bare quantified assertion (`^*`) already failed the native syntax check; a
    // group holding one (`(?:^)*`) is valid, and `mark` keeps its epsilon loop finite.
    return { t: 'rep', node, min, max }
  }

  private atom(): Node {
    const c = this.peek()!
    if (c === '(') return this.group()
    if (c === '^') { this.i++; return { t: 'assert', kind: 'start' } }
    if (c === '$') { this.i++; return { t: 'assert', kind: 'end' } }
    if (c === '[') return { t: 'atom', test: nativeAtom(this.classSource()) }
    if (c === '\\') return this.escape()
    if (c === '.') { this.i++; return { t: 'atom', test: nativeAtom('.') } }
    const cp = this.src.codePointAt(this.i)!
    const text = String.fromCodePoint(cp)
    this.i += text.length
    return { t: 'atom', test: (other) => other === cp }
  }

  private group(): Node {
    this.i++ // (
    if (this.src.startsWith('?:', this.i)) this.i += 2
    else if (this.src.startsWith('?<', this.i) && this.src[this.i + 2] !== '=' && this.src[this.i + 2] !== '!') {
      const close = this.src.indexOf('>', this.i)
      if (close < 0) throw new UnsupportedPattern('unterminated group name')
      this.i = close + 1
    } else if (this.peek() === '?') {
      throw new UnsupportedPattern('lookaround')
    }
    const node = this.alternation()
    if (this.peek() !== ')') throw new UnsupportedPattern('unterminated group')
    this.i++
    return node
  }

  /** The source text of a `[...]` class; `u`-mode classes do not nest. */
  private classSource(): string {
    const start = this.i
    this.i++ // [
    while (this.i < this.src.length && this.src[this.i] !== ']') {
      this.i += this.src[this.i] === '\\' ? 2 : 1
    }
    if (this.src[this.i] !== ']') throw new UnsupportedPattern('unterminated class')
    this.i++
    return this.src.slice(start, this.i)
  }

  private escape(): Node {
    const start = this.i
    const next = this.src[this.i + 1]
    if (next === undefined) throw new UnsupportedPattern('trailing backslash')
    if (next === 'b' || next === 'B') {
      this.i += 2
      return { t: 'assert', kind: next === 'b' ? 'word' : 'nonword' }
    }
    if (/[1-9]/.test(next) || next === 'k') throw new UnsupportedPattern('a backreference')
    let length = 2
    const rest = this.src.slice(this.i)
    const sized = /^\\(?:u\{[0-9a-fA-F]+\}|u[dD][89abAB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|c[a-zA-Z]|[pP]\{[^}]*\})/.exec(rest)
    if (sized) length = sized[0].length
    this.i += length
    return { t: 'atom', test: nativeAtom(this.src.slice(start, this.i)) }
  }
}

class Compiler {
  readonly prog: Inst[] = []

  private emit(inst: Inst): number {
    if (this.prog.length >= MAX_INSTRUCTIONS) throw new UnsupportedPattern('too complex')
    this.prog.push(inst)
    return this.prog.length - 1
  }

  compile(node: Node): void {
    switch (node.t) {
      case 'atom': this.emit({ op: 'atom', test: node.test }); return
      case 'assert': this.emit({ op: 'assert', kind: node.kind }); return
      case 'seq': for (const item of node.items) this.compile(item); return
      case 'alt': {
        const jumps: number[] = []
        node.options.forEach((option, index) => {
          if (index === node.options.length - 1) {
            this.compile(option)
            return
          }
          const split = this.emit({ op: 'split', x: 0, y: 0 })
          ;(this.prog[split] as { x: number }).x = this.prog.length
          this.compile(option)
          jumps.push(this.emit({ op: 'jmp', x: 0 }))
          ;(this.prog[split] as { y: number }).y = this.prog.length
        })
        for (const jump of jumps) (this.prog[jump] as { x: number }).x = this.prog.length
        return
      }
      case 'rep': {
        for (let n = 0; n < node.min; n++) this.compile(node.node)
        if (node.max === Infinity) {
          const split = this.emit({ op: 'split', x: 0, y: 0 })
          ;(this.prog[split] as { x: number }).x = this.prog.length
          this.compile(node.node)
          this.emit({ op: 'jmp', x: split })
          ;(this.prog[split] as { y: number }).y = this.prog.length
          return
        }
        const splits: number[] = []
        for (let n = node.min; n < node.max; n++) {
          const split = this.emit({ op: 'split', x: 0, y: 0 })
          ;(this.prog[split] as { x: number }).x = this.prog.length
          splits.push(split)
          this.compile(node.node)
        }
        for (const split of splits) (this.prog[split] as { y: number }).y = this.prog.length
      }
    }
  }
}

const isWord = (cp: number | undefined) => cp !== undefined && (
  (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || cp === 95
)

export interface LinearRegex {
  test(input: string): boolean
}

/** Compile `pattern`, or throw `UnsupportedPattern` / `SyntaxError`. */
export function compileLinearRegex(pattern: string): LinearRegex {
  new RegExp(pattern, 'u') // Reject invalid syntax the way the native engine would.
  const compiler = new Compiler()
  compiler.compile(new Parser(pattern).parse())
  compiler.prog.push({ op: 'match' })
  const prog = compiler.prog

  return {
    test(input) {
      const cps = Array.from(input, (ch) => ch.codePointAt(0)!)
      const mark = new Int32Array(prog.length).fill(-1)
      let current: number[] = []
      let next: number[] = []
      let matched = false

      // Follow epsilon edges from `pc` at position `pos`; `generation` dedups states per step.
      const add = (list: number[], start: number, pos: number, generation: number) => {
        const stack = [start]
        while (stack.length) {
          const pc = stack.pop()!
          if (mark[pc] === generation) continue
          mark[pc] = generation
          const inst = prog[pc]!
          if (inst.op === 'jmp') stack.push(inst.x)
          else if (inst.op === 'split') stack.push(inst.y, inst.x)
          else if (inst.op === 'assert') {
            const before = cps[pos - 1]
            const after = cps[pos]
            const ok = inst.kind === 'start' ? pos === 0
              : inst.kind === 'end' ? pos === cps.length
                : (isWord(before) !== isWord(after)) === (inst.kind === 'word')
            if (ok) stack.push(pc + 1)
          } else if (inst.op === 'match') matched = true
          else list.push(pc)
        }
      }

      for (let pos = 0; pos <= cps.length; pos++) {
        // Unanchored search: a new attempt may start at every position.
        add(current, 0, pos, pos)
        if (matched) return true
        if (pos === cps.length) break
        const cp = cps[pos]!
        next = []
        for (const pc of current) {
          const inst = prog[pc] as Extract<Inst, { op: 'atom' }>
          if (inst.test(cp)) add(next, pc + 1, pos + 1, pos + 1)
        }
        if (matched) return true
        current = next
      }
      return matched
    },
  }
}
