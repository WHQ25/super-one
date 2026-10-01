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
 *
 * Both phases are budgeted, since a small pattern can still be made expensive:
 * compiling stops with `UnsupportedPattern('too complex')` past the limits
 * below, and `test` gives up (`undefined`) once its `MatchBudget` runs out.
 * Compiling charges its work to a budget too, whether or not it succeeds.
 */

/** Upper bounds on source length, group nesting and compiled NFA instructions. */
export const MAX_PATTERN_LENGTH = 2048
const MAX_DEPTH = 64
const MAX_INSTRUCTIONS = 10_000
/** Every node visit counts, so repeating what compiles to nothing, `(?:){1000000000}`, stays bounded. */
const MAX_COMPILE_WORK = 100_000

export class UnsupportedPattern extends Error {}

export interface MatchBudget {
  /** Remaining NFA steps; `test` deducts what it used. */
  steps: number
}

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
  private depth = 0
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
      if (min > MAX_INSTRUCTIONS || (max !== Infinity && max > MAX_INSTRUCTIONS)) throw new UnsupportedPattern('too complex')
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
    if (++this.depth > MAX_DEPTH) throw new UnsupportedPattern('too complex')
    const node = this.alternation()
    this.depth--
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
  /** Node visits so far, charged to the caller's budget. */
  work = 0

  private emit(inst: Inst): number {
    if (this.prog.length >= MAX_INSTRUCTIONS) throw new UnsupportedPattern('too complex')
    this.prog.push(inst)
    return this.prog.length - 1
  }

  compile(node: Node): void {
    if (++this.work > MAX_COMPILE_WORK) throw new UnsupportedPattern('too complex')
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

/** ASCII word characters; astral code points and lone surrogates are not, so UTF-16 units suffice. */
const isWord = (unit: number) => (unit >= 48 && unit <= 57) || (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122) || unit === 95

export interface LinearRegex {
  /** Compiled NFA instructions, a measure of the pattern's memory and per-step cost. */
  readonly size: number
  /** Whether `input` matches; `undefined` when `budget` ran out first. */
  test(input: string, budget?: MatchBudget): boolean | undefined
}

/**
 * Compile `pattern`, or throw `UnsupportedPattern` / `SyntaxError`. `budget`
 * pays for the work either way: one step per source character and node visit.
 */
export function compileLinearRegex(pattern: string, budget?: MatchBudget): LinearRegex {
  const compiler = new Compiler()
  try {
    if (pattern.length > MAX_PATTERN_LENGTH) throw new UnsupportedPattern('too complex')
    new RegExp(pattern, 'u') // Reject invalid syntax the way the native engine would.
    compiler.compile(new Parser(pattern).parse())
  } finally {
    if (budget) budget.steps -= Math.min(pattern.length, MAX_PATTERN_LENGTH) + compiler.work
  }
  compiler.prog.push({ op: 'match' })
  const prog = compiler.prog

  return {
    size: prog.length,
    test(input, budget) {
      const limit = budget ? budget.steps : Infinity
      let steps = 0
      const done = (result: boolean | undefined) => {
        if (budget) budget.steps -= steps
        return result
      }
      const mark = new Int32Array(prog.length).fill(-1)
      let current: number[] = []
      let matched = false

      // Follow epsilon edges from `pc` at UTF-16 index `at`; `generation` dedups states per step.
      const add = (list: number[], start: number, at: number, generation: number) => {
        const stack = [start]
        while (stack.length) {
          const pc = stack.pop()!
          if (mark[pc] === generation) continue
          mark[pc] = generation
          steps++
          const inst = prog[pc]!
          if (inst.op === 'jmp') stack.push(inst.x)
          else if (inst.op === 'split') stack.push(inst.y, inst.x)
          else if (inst.op === 'assert') {
            const ok = inst.kind === 'start' ? at === 0
              : inst.kind === 'end' ? at === input.length
                : (isWord(input.charCodeAt(at - 1)) !== isWord(input.charCodeAt(at))) === (inst.kind === 'word')
            if (ok) stack.push(pc + 1)
          } else if (inst.op === 'match') matched = true
          else list.push(pc)
        }
      }

      // Walk code points by UTF-16 index; a lone surrogate is one code point, as in `u` mode.
      for (let at = 0; ; ) {
        // Unanchored search: a new attempt may start at every position.
        add(current, 0, at, at)
        if (matched) return done(true)
        if (at === input.length) return done(false)
        const cp = input.codePointAt(at)!
        const nextAt = at + (cp > 0xffff ? 2 : 1)
        const next: number[] = []
        for (const pc of current) {
          steps++
          const inst = prog[pc] as Extract<Inst, { op: 'atom' }>
          if (inst.test(cp)) add(next, pc + 1, nextAt, nextAt)
        }
        if (matched) return done(true)
        // One position costs at most a few steps per instruction, so checking here bounds the overshoot.
        if (steps > limit) return done(undefined)
        current = next
        at = nextAt
      }
    },
  }
}
