import { useMemo } from 'react'
import type { Dag, DagNode, DagGroup } from './workflow-dag'

const NODE_W = 150
const NODE_H = 46
const COL_GAP = 46
const ROW_GAP = 16
const PAD = 16

const GROUP_STROKE: Record<DagGroup, string> = {
  serial: '#1d9e75',
  parallel: '#7f77dd',
  pipeline: '#378add',
  workflow: '#888780',
}

const STATUS_DOT: Record<string, string> = {
  done: '#3b6d11',
  running: '#ba7517',
  failed: '#a32d2d',
}

interface WorkflowDagProps {
  dag: Dag
  selectedLabel?: string
  onSelect?: (label: string) => void
}

function truncate(text: string, max = 18): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

export function WorkflowDag({ dag, selectedLabel, onSelect }: WorkflowDagProps) {
  const layout = useMemo(() => {
    const maxRows = dag.nodes.reduce((m, n) => Math.max(m, n.rows), 1)
    const contentH = maxRows * NODE_H + (maxRows - 1) * ROW_GAP
    const height = contentH + PAD * 2
    const width = PAD * 2 + Math.max(1, dag.cols) * NODE_W + Math.max(0, dag.cols - 1) * COL_GAP
    const centerY = height / 2
    const pos = new Map<string, { x: number; y: number; cx: number; cy: number }>()
    for (const n of dag.nodes) {
      const groupH = n.rows * NODE_H + (n.rows - 1) * ROW_GAP
      const x = PAD + n.col * (NODE_W + COL_GAP)
      const y = centerY - groupH / 2 + n.row * (NODE_H + ROW_GAP)
      pos.set(n.id, { x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 })
    }
    return { width, height, pos }
  }, [dag])

  const nodeById = useMemo(() => new Map(dag.nodes.map((n) => [n.id, n] as const)), [dag])

  return (
    <div className="overflow-x-auto">
      <svg width={layout.width} height={layout.height} style={{ minWidth: '100%' }}>
        <defs>
          <marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>

        {dag.edges.map((e, i) => {
          const a = layout.pos.get(e.from)
          const b = layout.pos.get(e.to)
          if (!a || !b) return null
          const x1 = a.x + NODE_W
          const x2 = b.x
          const mx = (x1 + x2) / 2
          return (
            <path
              key={i}
              d={`M${x1} ${a.cy} C${mx} ${a.cy} ${mx} ${b.cy} ${x2} ${b.cy}`}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeOpacity={0.45}
              strokeWidth={1}
              markerEnd="url(#wf-arrow)"
            />
          )
        })}

        {dag.nodes.map((n) => {
          const p = layout.pos.get(n.id)!
          return <DagNodeShape key={n.id} node={n} x={p.x} y={p.y} selected={!!selectedLabel && n.label === selectedLabel} onSelect={onSelect} />
        })}
      </svg>
    </div>
  )
}

function DagNodeShape({ node, x, y, selected, onSelect }: { node: DagNode; x: number; y: number; selected: boolean; onSelect?: (label: string) => void }) {
  const stroke = GROUP_STROKE[node.group]
  const dot = node.status ? STATUS_DOT[node.status] : undefined
  return (
    <g
      transform={`translate(${x} ${y})`}
      onClick={onSelect ? () => onSelect(node.label) : undefined}
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
    >
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={6}
        fill="var(--card)"
        stroke={stroke}
        strokeWidth={selected ? 2 : 1}
        strokeDasharray={node.dynamic ? '4 3' : undefined}
      />
      {dot && <circle cx={12} cy={NODE_H / 2} r={3.5} fill={dot} />}
      <text x={dot ? 24 : 12} y={20} fontSize={12} fontWeight={500} fill="var(--foreground)">{truncate(node.label)}</text>
      <text x={dot ? 24 : 12} y={36} fontSize={11} fill="var(--muted-foreground)">
        {node.group}
        {node.dynamic ? ' · ×N' : ''}
        {typeof node.toolCount === 'number' && node.toolCount > 0 ? ` · ${node.toolCount} tools` : ''}
      </text>
    </g>
  )
}
