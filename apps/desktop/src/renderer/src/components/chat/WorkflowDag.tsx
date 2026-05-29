import { useMemo } from 'react'
import { Wrench } from 'lucide-react'
import { layoutDag, NODE_W, NODE_H, type Dag, type DagNode, type DagGroup, type DagNodeStats } from './workflow-dag'
import { formatTokens } from './chat-shared'

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
  selectedNodeId?: string
  onSelect?: (node: DagNode) => void
  stats?: Map<string, DagNodeStats>
  bare?: boolean
}

function truncate(text: string, max = 18): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

export function WorkflowDag({ dag, selectedNodeId, onSelect, stats, bare }: WorkflowDagProps) {
  const layout = useMemo(() => layoutDag(dag), [dag])

  const svg = (
    <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="xMidYMid meet" style={bare ? undefined : { minWidth: '100%' }}>
        <defs>
          <marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>

        {layout.groups.map((g) => (
          <g key={`grp-${g.name}`}>
            <rect
              x={g.x}
              y={g.y}
              width={g.w}
              height={g.h}
              rx={8}
              fill="var(--muted-foreground)"
              fillOpacity={0.04}
              stroke={GROUP_STROKE.workflow}
              strokeOpacity={0.6}
              strokeWidth={1}
              strokeDasharray="5 4"
            />
            <text x={g.x + 7} y={g.y - 4} fontSize={10} fontWeight={600} fill={GROUP_STROKE.workflow}>
              ▸ {truncate(g.name, 28)}
            </text>
          </g>
        ))}

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
          return <DagNodeShape key={n.id} node={n} x={p.x} y={p.y} selected={n.id === selectedNodeId} stats={stats?.get(n.id)} onSelect={onSelect} />
        })}
      </svg>
  )

  if (bare) return svg
  return <div className="overflow-x-auto">{svg}</div>
}

function DagNodeShape({ node, x, y, selected, stats, onSelect }: { node: DagNode; x: number; y: number; selected: boolean; stats?: DagNodeStats; onSelect?: (node: DagNode) => void }) {
  const stroke = GROUP_STROKE[node.group]
  const dot = node.status ? STATUS_DOT[node.status] : undefined
  const toolCount = stats?.toolCount ?? node.toolCount
  const tokens = stats?.tokens
  const subtitle = node.prompt || node.group + (node.dynamic ? ' · ×N' : '')
  const hasFooter = (typeof toolCount === 'number' && toolCount > 0) || (typeof tokens === 'number' && tokens > 0)
  return (
    <g
      transform={`translate(${x} ${y})`}
      onClick={onSelect ? () => onSelect(node) : undefined}
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
    >
      <title>{node.prompt ?? node.label}</title>
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={8}
        fill="var(--card)"
        stroke={stroke}
        strokeWidth={selected ? 2 : 1}
        strokeDasharray={node.dynamic ? '4 3' : undefined}
      />
      <foreignObject x={0} y={0} width={NODE_W} height={NODE_H}>
        <div style={{ boxSizing: 'border-box', display: 'flex', height: '100%', flexDirection: 'column', padding: '9px 11px', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {dot && <span style={{ width: 7, height: 7, borderRadius: 99, background: dot, flexShrink: 0 }} />}
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.label}</span>
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 11,
              lineHeight: '15px',
              color: 'var(--muted-foreground)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {subtitle}
          </div>
          {hasFooter && (
            <div style={{ marginTop: 'auto', paddingTop: 4, display: 'flex', alignItems: 'center', gap: 10, fontSize: 10.5, color: 'var(--muted-foreground)' }}>
              {typeof toolCount === 'number' && toolCount > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Wrench size={10} /> {toolCount}
                </span>
              )}
              {typeof tokens === 'number' && tokens > 0 && (
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTokens(tokens)}</span>
              )}
            </div>
          )}
        </div>
      </foreignObject>
    </g>
  )
}
