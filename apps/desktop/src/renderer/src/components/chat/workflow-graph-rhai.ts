/**
 * Lightweight static graph extraction for Grok Build Rhai workflows.
 * Mirrors parseWorkflowGraph (JS/acorn) structure: phase / agent / parallel / pipeline / workflow.
 *
 * Not a full Rhai parser — best-effort scan of orchestration primitives. Dynamic
 * `parallel(jobs)` fan-outs often push `#{ label, prompt }` maps before the call;
 * we harvest those labels for the same phase when nested agent() calls are absent.
 */

import type { WorkflowAgentSpec, WorkflowBlock, WorkflowGraph } from './workflow-graph'

/** True when source looks like Grok Rhai rather than Claude compiled JS. */
export function looksLikeRhaiWorkflow(script: string): boolean {
  if (!script) return false
  if (/#\{/.test(script)) return true
  if (/\blet\s+meta\s*=/.test(script) && !/\bexport\s+const\s+meta\b/.test(script)) return true
  // Rhai-only surface often used in workflows.
  if (/\bfn\s+\w+\s*\(/.test(script) && /\bphase\s*\(/.test(script)) return true
  return false
}

/** Strip line and block comments without touching string contents (e.g. https URLs). */
function stripComments(src: string): string {
  let out = ''
  let i = 0
  let inStr: string | null = null
  let escape = false
  while (i < src.length) {
    const c = src[i]
    if (inStr) {
      out += c
      if (escape) {
        escape = false
      } else if (c === '\\') {
        escape = true
      } else if (c === inStr) {
        inStr = null
      }
      i++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      out += c
      i++
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      i += 2
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i = Math.min(src.length, i + 2)
      continue
    }
    out += c
    i++
  }
  return out
}

function unquote(raw: string): string {
  const s = raw.trim()
  if (
    (s.startsWith('"') && s.endsWith('"'))
    || (s.startsWith("'") && s.endsWith("'"))
    || (s.startsWith('`') && s.endsWith('`'))
  ) {
    return s.slice(1, -1)
  }
  return s
}

/** Balanced slice starting at openIdx pointing at `{` or `(`. */
function balancedSlice(src: string, openIdx: number): string | null {
  const open = src[openIdx]
  const close = open === '{' ? '}' : open === '(' ? ')' : open === '[' ? ']' : null
  if (!close) return null
  let depth = 0
  let inStr: string | null = null
  let escape = false
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (escape) {
        escape = false
        continue
      }
      if (c === '\\') {
        escape = true
        continue
      }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return src.slice(openIdx, i + 1)
    }
  }
  return null
}

function mapField(mapSrc: string, key: string): string | undefined {
  // label: "x" | label: 'x' | label: `x` | "label": "x"
  const re = new RegExp(
    `(?:^|[,{\\s])(?:"${key}"|'${key}'|${key})\\s*:\\s*(["'\`][^"'\`]*["'\`]|[^,}\\n]+)`,
    'm',
  )
  const m = mapSrc.match(re)
  if (!m) return undefined
  const raw = m[1].trim()
  // string concat template: "catalog:" + d.id → keep left literal prefix if present
  if (/^["'`]/.test(raw)) {
    const lit = unquote(raw.match(/^["'`][^"'`]*["'`]/)?.[0] ?? raw)
    if (/\+/.test(raw) && lit) return lit.endsWith(':') ? `${lit}*` : lit
    return lit
  }
  // bare identifier — not useful as label
  if (/^[A-Za-z_][\w.]*$/.test(raw)) return undefined
  return raw
}

function extractAgentFromCall(callBody: string): WorkflowAgentSpec {
  // agent(promptExpr, #{ ... }) or agent(promptExpr, { ... })
  const args = callBody
  let prompt: string | undefined
  let opts = ''

  const firstComma = findTopLevelComma(args)
  if (firstComma < 0) {
    prompt = stringyPrompt(args.trim())
  } else {
    prompt = stringyPrompt(args.slice(0, firstComma).trim())
    const rest = args.slice(firstComma + 1).trim()
    const mapStart = rest.search(/[#]?\{/)
    if (mapStart >= 0) {
      // include optional #
      const braceIdx = rest.indexOf('{', mapStart)
      const slice = balancedSlice(rest, braceIdx)
      if (slice) opts = slice
    }
  }

  return {
    label: opts ? mapField(opts, 'label') : undefined,
    prompt,
    agentType: opts ? mapField(opts, 'agentType') ?? mapField(opts, 'agent_type') : undefined,
    model: opts ? mapField(opts, 'model') : undefined,
  }
}

function stringyPrompt(expr: string): string | undefined {
  if (!expr) return undefined
  if (/^["'`]/.test(expr)) {
    const m = expr.match(/^["'`]([^"'`]*)["'`]/)
    return m ? m[1] : undefined
  }
  // variable prompt — leave undefined (label still identifies the node)
  return undefined
}

function findTopLevelComma(src: string): number {
  let depthParen = 0
  let depthBrace = 0
  let depthBracket = 0
  let inStr: string | null = null
  let escape = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (escape) {
        escape = false
        continue
      }
      if (c === '\\') {
        escape = true
        continue
      }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '(') depthParen++
    else if (c === ')') depthParen--
    else if (c === '{') depthBrace++
    else if (c === '}') depthBrace--
    else if (c === '[') depthBracket++
    else if (c === ']') depthBracket--
    else if (c === ',' && depthParen === 0 && depthBrace === 0 && depthBracket === 0) return i
  }
  return -1
}

function harvestLabelsInRegion(region: string): WorkflowAgentSpec[] {
  const agents: WorkflowAgentSpec[] = []
  const seen = new Set<string>()
  // label: "scan:ui-sidebar" or label: "catalog:" + d.id
  const re = /(?:^|[,{\s])(?:label)\s*:\s*(["'`][^"'`]*["'`](?:\s*\+\s*[^,}\n]+)?)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(region))) {
    const raw = m[1].trim()
    let label: string | undefined
    if (/^["'`]/.test(raw)) {
      const lit = unquote(raw.match(/^["'`][^"'`]*["'`]/)?.[0] ?? '')
      if (/\+/.test(raw) && lit) label = lit.endsWith(':') ? `${lit}*` : lit
      else label = lit || undefined
    }
    if (!label || seen.has(label)) continue
    seen.add(label)
    agents.push({ label })
  }
  return agents
}

function findAgentsInCallArgs(args: string): WorkflowAgentSpec[] {
  const agents: WorkflowAgentSpec[] = []
  const re = /\bagent\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(args))) {
    const openIdx = m.index + m[0].length - 1
    const call = balancedSlice(args, openIdx)
    if (!call) continue
    agents.push(extractAgentFromCall(call.slice(1, -1)))
    re.lastIndex = openIdx + call.length
  }
  return agents
}

function scanOrchestrationHits(
  src: string,
  hits: Array<
    | { kind: 'phase'; index: number; title: string; end: number }
    | { kind: 'call'; index: number; name: 'agent' | 'parallel' | 'pipeline' | 'workflow'; end: number; args: string }
  >,
): void {
  let i = 0
  let inStr: string | null = null
  let escape = false
  while (i < src.length) {
    const c = src[i]
    if (inStr) {
      if (escape) {
        escape = false
        i++
        continue
      }
      if (c === '\\') {
        escape = true
        i++
        continue
      }
      if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      i++
      continue
    }
    // phase("Title")
    if (src.startsWith('phase', i) && (i === 0 || !/\w/.test(src[i - 1]!))) {
      let j = i + 5
      while (j < src.length && /\s/.test(src[j]!)) j++
      if (src[j] === '(') {
        const call = balancedSlice(src, j)
        if (call) {
          const inner = call.slice(1, -1).trim()
          const lit = inner.match(/^(["'`][^"'`]+["'`])/)
          if (lit) {
            hits.push({
              kind: 'phase',
              index: i,
              title: unquote(lit[1]),
              end: j + call.length,
            })
          }
          i = j + call.length
          continue
        }
      }
    }
    let advanced = false
    for (const name of ['agent', 'parallel', 'pipeline', 'workflow'] as const) {
      if (!src.startsWith(name, i)) continue
      if (i > 0 && /\w/.test(src[i - 1]!)) continue
      const after = i + name.length
      if (after < src.length && /\w/.test(src[after]!)) continue
      let j = after
      while (j < src.length && /\s/.test(src[j]!)) j++
      if (src[j] !== '(') continue
      const call = balancedSlice(src, j)
      if (!call) continue
      const nested = hits.some(
        (h) => h.kind === 'call' && i > h.index && i < h.end,
      )
      if (nested && name === 'agent') {
        i = j + call.length
        advanced = true
        break
      }
      hits.push({
        kind: 'call',
        index: i,
        name,
        end: j + call.length,
        args: call.slice(1, -1),
      })
      i = j + call.length
      advanced = true
      break
    }
    if (!advanced) i++
  }
}

/**
 * Scan Rhai workflow source for orchestration structure.
 */
export function parseRhaiWorkflowGraph(script: string): WorkflowGraph {
  const phases: string[] = []
  const blocks: WorkflowBlock[] = []
  const src = stripComments(script)
  let currentPhase: string | undefined
  // Region since last phase/block for harvesting parallel job labels.
  let regionStart = 0

  // Collect phase positions + call positions in order (skip string/comment interiors).
  type Hit =
    | { kind: 'phase'; index: number; title: string; end: number }
    | { kind: 'call'; index: number; name: 'agent' | 'parallel' | 'pipeline' | 'workflow'; end: number; args: string }

  const hits: Hit[] = []
  scanOrchestrationHits(src, hits)

  hits.sort((a, b) => a.index - b.index || (a.kind === 'phase' ? -1 : 1))

  for (const hit of hits) {
    if (hit.kind === 'phase') {
      currentPhase = hit.title
      if (!phases.includes(hit.title)) phases.push(hit.title)
      regionStart = hit.end
      continue
    }

    const region = src.slice(regionStart, hit.index)

    if (hit.name === 'agent') {
      // Skip agents nested in later-recorded outer calls (already filtered) and
      // agents that only appear inside for-loop job builders before parallel —
      // those are harvested into the parallel block. Heuristic: if the same
      // region ends with a .push of a map (no agent call at this hit being
      // "standalone"), still record top-level agent assignments.
      blocks.push({ kind: 'agent', phase: currentPhase, agent: extractAgentFromCall(hit.args) })
      regionStart = hit.end
      continue
    }

    if (hit.name === 'parallel') {
      let agents = findAgentsInCallArgs(hit.args)
      const dynamic = agents.length === 0
      if (agents.length === 0) {
        // Jobs built via push(#{ label, prompt }) in this phase region.
        agents = harvestLabelsInRegion(region)
      }
      // Also labels inside the parallel argument if it's an array of maps.
      if (agents.length === 0) agents = harvestLabelsInRegion(hit.args)
      blocks.push({
        kind: 'parallel',
        phase: currentPhase,
        dynamic: dynamic || agents.length === 0,
        agents,
      })
      regionStart = hit.end
      continue
    }

    if (hit.name === 'pipeline') {
      const agents = findAgentsInCallArgs(hit.args)
      blocks.push({
        kind: 'pipeline',
        phase: currentPhase,
        dynamic: agents.length === 0,
        stages: Math.max(1, agents.length || 1),
        agents,
      })
      regionStart = hit.end
      continue
    }

    if (hit.name === 'workflow') {
      const nameLit = hit.args.trim().match(/^(["'`][^"'`]+["'`])/)
      let wfName = nameLit ? unquote(nameLit[1]) : undefined
      let scriptPath: string | undefined
      const mapStart = hit.args.search(/[#]?\{/)
      if (mapStart >= 0) {
        const braceIdx = hit.args.indexOf('{', mapStart)
        const map = balancedSlice(hit.args, braceIdx)
        if (map) {
          scriptPath = mapField(map, 'script_path') ?? mapField(map, 'scriptPath')
          wfName = wfName ?? mapField(map, 'name')
          if (!wfName && scriptPath) {
            const base = scriptPath.split('/').pop() ?? scriptPath
            wfName = base.replace(/\.rhai$/i, '')
          }
        }
      }
      blocks.push({ kind: 'workflow', phase: currentPhase, name: wfName, scriptPath })
      regionStart = hit.end
    }
  }

  // Fallback: meta.phases titles when no phase() calls were found.
  if (phases.length === 0) {
    const metaMatch = src.match(/\bmeta\s*=\s*#?\{/)
    if (metaMatch && metaMatch.index != null) {
      const braceIdx = src.indexOf('{', metaMatch.index)
      const meta = balancedSlice(src, braceIdx)
      if (meta) {
        const phasesKey = meta.search(/\bphases\s*:/)
        if (phasesKey >= 0) {
          const arrStart = meta.indexOf('[', phasesKey)
          if (arrStart >= 0) {
            const arr = balancedSlice(meta, arrStart)
            if (arr) {
              const titleRe = /\btitle\s*:\s*(["'`][^"'`]+["'`])/g
              let tm: RegExpExecArray | null
              while ((tm = titleRe.exec(arr))) {
                const t = unquote(tm[1])
                if (t && !phases.includes(t)) phases.push(t)
              }
            }
          }
        }
      }
    }
  }

  return { phases, blocks }
}
