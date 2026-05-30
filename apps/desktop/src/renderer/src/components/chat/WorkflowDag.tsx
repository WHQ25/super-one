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

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2
  return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`
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

        {layout.subworkflows.map((s) => (
          <g key={`sw-${s.name}`}>
            <rect
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx={12}
              fill="var(--muted-foreground)"
              fillOpacity={0.03}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.35}
              strokeWidth={1}
              strokeDasharray="6 4"
            />
            <text x={s.x + 12} y={s.y + 15} fontSize={11} fontWeight={700} fill="var(--muted-foreground)">
              ▸ {truncate(s.name, 30)}
            </text>
          </g>
        ))}

        {layout.clusters.slice(0, -1).map((c, i) => {
          const next = layout.clusters[i + 1]
          return (
            <path
              key={`conn-${c.key}`}
              d={curve(c.x + c.w, c.cy, next.x, next.cy)}
              fill="none"
              stroke="var(--muted-foreground)"
              strokeOpacity={0.5}
              strokeWidth={1.5}
              strokeDasharray="6 5"
              markerEnd="url(#wf-arrow)"
            />
          )
        })}

        {layout.clusters.map((c) => {
          const empty = c.count === 0
          return (
            <g key={`cl-${c.key}`}>
              <rect
                x={c.x}
                y={c.y}
                width={c.w}
                height={c.h}
                rx={10}
                fill="var(--muted-foreground)"
                fillOpacity={empty ? 0.015 : 0.035}
                stroke="var(--muted-foreground)"
                strokeOpacity={empty ? 0.2 : 0.25}
                strokeWidth={1}
                strokeDasharray={empty ? '5 4' : undefined}
              />
              {c.label && (
                <text x={c.x + 12} y={c.y + 16} fontSize={11} fontWeight={600} fill="var(--muted-foreground)" fillOpacity={empty ? 0.6 : 1}>
                  {truncate(c.label, 26)}{c.count !== 1 ? ` · ${c.count}` : ''}
                </text>
              )}
            </g>
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
