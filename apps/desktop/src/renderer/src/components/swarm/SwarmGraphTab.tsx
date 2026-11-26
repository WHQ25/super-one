import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { BeeIcon } from '@superone/chat-view/presenters/SubagentBlock'
import type { SwarmBoardSnapshot } from '@superone/shared/swarm-board-types'
import { cn } from '@superone/ui/lib/utils'
import {
  computeSwarmProgress,
  formatBoardDuration,
  getMemberPalette,
  isTaskDoneForMember,
} from './swarm-board-utils'

interface SwarmGraphTabProps {
  snapshot: SwarmBoardSnapshot
  memberColorMap?: Record<string, number>
}

type GraphMode = 'hive' | 'mentions'

const HEX_R = 46
const HEX_GAP = 1.16
const SQRT3 = Math.sqrt(3)

const AXIAL_DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
]

function generateAxialSpiral(count: number): Array<[number, number]> {
  if (count === 1) return [[0, -1]]
  if (count === 2) return [[0, -1], [0, 1]]
  if (count === 3) return [[0, -1], [1, 0], [-1, 1]]
  if (count === 4) return [[1, -1], [1, 0], [-1, 1], [-1, 0]]
  if (count === 5) return [[0, -1], [1, -1], [1, 0], [-1, 1], [-1, 0]]

  const result: Array<[number, number]> = []
  let ring = 1
  while (result.length < count) {
    let q = 0
    let r = -ring
    for (let dir = 0; dir < 6 && result.length < count; dir += 1) {
      const [dq, dr] = AXIAL_DIRECTIONS[dir]!
      for (let step = 0; step < ring && result.length < count; step += 1) {
        result.push([q, r])
        q += dq
        r += dr
      }
    }
    ring += 1
  }
  return result
}

function axialToPixel(q: number, r: number, cx: number, cy: number, stepRadius: number): { x: number; y: number } {
  return {
    x: cx + stepRadius * 1.5 * q,
    y: cy + stepRadius * SQRT3 * (r + q / 2),
  }
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 3) * i
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`)
  }
  return pts.join(' ')
}

export function SwarmGraphTab({ snapshot, memberColorMap = {} }: SwarmGraphTabProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<GraphMode>('hive')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<1 | 2>(1)
  const totalPosts = snapshot.messages.length
  const [cursor, setCursor] = useState<number>(totalPosts)

  useEffect(() => {
    if (!playing) {
      setCursor(totalPosts)
    }
  }, [totalPosts, playing])

  useEffect(() => {
    if (!playing || totalPosts === 0) return
    const timer = setInterval(() => {
      setCursor((prev) => {
        if (prev >= totalPosts) {
          setPlaying(false)
          return totalPosts
        }
        return prev + 1
      })
    }, speed === 2 ? 450 : 900)
    return () => clearInterval(timer)
  }, [playing, speed, totalPosts])

  const effectiveCursor = Math.min(cursor, totalPosts)
  const visibleMessages = useMemo(
    () => snapshot.messages.slice(0, effectiveCursor),
    [snapshot.messages, effectiveCursor],
  )
  const latestMessage = visibleMessages[visibleMessages.length - 1]
  const isAtLive = effectiveCursor >= totalPosts

  const slicedSnapshot = useMemo<SwarmBoardSnapshot>(
    () => ({ ...snapshot, messages: visibleMessages }),
    [snapshot, visibleMessages],
  )
  const { doneTasks, totalTasks } = useMemo(
    () => computeSwarmProgress(slicedSnapshot),
    [slicedSnapshot],
  )
  const membersByName = useMemo(
    () => new Map(snapshot.members.map((m) => [m.name, m])),
    [snapshot.members],
  )
  const durationText = useMemo(
    () => formatBoardDuration(snapshot.messages),
    [snapshot.messages],
  )

  const workers = useMemo(
    () => snapshot.members.filter((m) => m.role !== 'coordinator'),
    [snapshot.members],
  )

  const hiveMemberCoords = useMemo(() => {
    const coords = new Map<string, { x: number; y: number }>()
    coords.set('coordinator', { x: 0, y: 0 })
    const offsets = generateAxialSpiral(workers.length)
    const stepRadius = HEX_R * HEX_GAP
    workers.forEach((member, idx) => {
      const offset = offsets[idx]
      if (!offset) return
      coords.set(member.name, axialToPixel(offset[0], offset[1], 0, 0, stepRadius))
    })
    return coords
  }, [workers])

  const hiveViewBox = useMemo(() => {
    let minX = -HEX_R
    let maxX = HEX_R
    let minY = -HEX_R
    let maxY = HEX_R
    for (const pos of hiveMemberCoords.values()) {
      minX = Math.min(minX, pos.x - HEX_R)
      maxX = Math.max(maxX, pos.x + HEX_R)
      minY = Math.min(minY, pos.y - HEX_R)
      maxY = Math.max(maxY, pos.y + HEX_R)
    }
    const pad = 24
    const width = Math.max(320, maxX - minX + pad * 2)
    const height = Math.max(260, maxY - minY + pad * 2)
    return `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`
  }, [hiveMemberCoords])

  const mentionNodes = useMemo(() => {
    const hasCoordinator = snapshot.members.some((m) => m.role === 'coordinator')
    const cx = 240
    const cy = 190
    const radius = workers.length > 8 ? 145 : 122
    const nodes: Array<{ name: string; x: number; y: number }> = []
    if (hasCoordinator) nodes.push({ name: 'coordinator', x: cx, y: cy })
    workers.forEach((m, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(1, workers.length) - Math.PI / 2
      nodes.push({
        name: m.name,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      })
    })
    return nodes
  }, [snapshot.members, workers])

  const mentionNodeMap = useMemo(
    () => new Map(mentionNodes.map((n) => [n.name, n])),
    [mentionNodes],
  )

  const renderMemberEdges = (coords: Map<string, { x: number; y: number }>) => {
    const allWorkerNames = workers.map((m) => m.name)
    return visibleMessages.map((msg) => {
      const from = coords.get(msg.agent)
      if (!from) return null
      const targets = msg.mentions.includes('all') ? allWorkerNames : msg.mentions
      const isLatest = latestMessage?.seq === msg.seq
      return targets.map((target) => {
        const to = coords.get(target)
        if (!to || target === msg.agent) return null
        const dx = to.x - from.x
        const dy = to.y - from.y
        const len = Math.hypot(dx, dy) || 1
        const pad = 20
        const x1 = from.x + (dx / len) * pad
        const y1 = from.y + (dy / len) * pad
        const x2 = to.x - (dx / len) * pad
        const y2 = to.y - (dy / len) * pad
        const strokeColor = isLatest ? '#f59e0b' : 'currentColor'
        return (
          <line
            key={`${msg.seq}-${target}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={strokeColor}
            strokeOpacity={isLatest ? 0.95 : 0.2}
            strokeWidth={isLatest ? 2.2 : 1.1}
            strokeDasharray={isLatest ? undefined : '3 3'}
            markerEnd={isLatest ? 'url(#swarm-arrow-active)' : 'url(#swarm-arrow-muted)'}
          />
        )
      })
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 text-muted-foreground">
            <button
              type="button"
              onClick={() => { setPlaying(false); setCursor(0) }}
              className="rounded p-1 hover:bg-muted hover:text-foreground"
              aria-label="First"
            >
              <SkipBack className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => { setPlaying(false); setCursor((c) => Math.max(0, c - 1)) }}
              className="rounded p-1 hover:bg-muted hover:text-foreground"
              aria-label="Previous"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (!playing && effectiveCursor >= totalPosts) setCursor(0)
                setPlaying((p) => !p)
              }}
              className="rounded p-1 text-foreground hover:bg-muted"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => { setPlaying(false); setCursor((c) => Math.min(totalPosts, c + 1)) }}
              className="rounded p-1 hover:bg-muted hover:text-foreground"
              aria-label="Next"
            >
              <ChevronRight className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => { setPlaying(false); setCursor(totalPosts) }}
              className="rounded p-1 hover:bg-muted hover:text-foreground"
              aria-label="Latest"
            >
              <SkipForward className="size-3.5" />
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(1, totalPosts)}
            value={effectiveCursor}
            onChange={(e) => {
              setPlaying(false)
              setCursor(Number(e.target.value))
            }}
            className="h-1 flex-1 accent-foreground"
          />

          <button
            type="button"
            onClick={() => { setPlaying(false); setCursor(totalPosts) }}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                isAtLive && snapshot.isLive ? 'bg-emerald-500' : isAtLive ? 'bg-emerald-500/70' : 'bg-muted-foreground',
              )}
            />
            {t('swarmBoard.live')}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {t('swarmBoard.graph.postsOver', { count: effectiveCursor, duration: durationText })}
          </span>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border/70 bg-muted/40 p-0.5">
              <button
                type="button"
                onClick={() => setMode('hive')}
                className={cn(
                  'rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                  mode === 'hive' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('swarmBoard.graph.hive')}
              </button>
              <button
                type="button"
                onClick={() => setMode('mentions')}
                className={cn(
                  'rounded-md px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                  mode === 'mentions' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('swarmBoard.graph.mentions')}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))}
              className="rounded-md border border-border/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {speed}x
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="flex min-h-[340px] flex-col items-center justify-center">
          <svg
            viewBox={mode === 'hive' ? hiveViewBox : '0 0 480 380'}
            className="h-full max-h-[420px] w-full"
          >
            <defs>
              <marker id="swarm-arrow-active" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#f59e0b" />
              </marker>
              <marker id="swarm-arrow-muted" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                <path d="M0,0 L5,2.5 L0,5 Z" fill="currentColor" fillOpacity="0.35" />
              </marker>
            </defs>

            {mode === 'hive' ? (
              <g>
                <polygon
                  points={hexPoints(0, 0, HEX_R)}
                  fill="rgba(245, 158, 11, 0.08)"
                  stroke={latestMessage?.agent === 'coordinator' ? '#f59e0b' : '#10b981'}
                  strokeWidth={latestMessage?.agent === 'coordinator' ? 2 : 1.5}
                />

                {workers.map((member) => {
                  const pos = hiveMemberCoords.get(member.name)
                  if (!pos) return null
                  const done = isTaskDoneForMember(member.name, visibleMessages, membersByName)
                  const isSender = latestMessage?.agent === member.name
                  return (
                    <polygon
                      key={`hex-${member.name}`}
                      points={hexPoints(pos.x, pos.y, HEX_R)}
                      fill={done ? 'rgba(16, 185, 129, 0.07)' : 'rgba(148, 163, 184, 0.05)'}
                      stroke={isSender ? '#f59e0b' : done ? '#10b981' : '#94a3b8'}
                      strokeOpacity={isSender || done ? 0.9 : 0.45}
                      strokeWidth={isSender ? 2 : 1.4}
                    />
                  )
                })}

                {renderMemberEdges(hiveMemberCoords)}

                {workers.map((member) => {
                  const pos = hiveMemberCoords.get(member.name)
                  if (!pos) return null
                  const palette = getMemberPalette(member.name, memberColorMap[member.name.toLowerCase()])
                  const done = isTaskDoneForMember(member.name, visibleMessages, membersByName)
                  return (
                    <g key={member.name} transform={`translate(${pos.x - 13}, ${pos.y - 18})`}>
                      <BeeIcon color={palette.hex} width={26} height={26} />
                      <circle
                        cx={24}
                        cy={3}
                        r={3}
                        fill={done ? '#10b981' : '#f59e0b'}
                      />
                      <text
                        x={13}
                        y={36}
                        textAnchor="middle"
                        className="fill-foreground text-[9px] font-medium"
                      >
                        {member.name.length > 12 ? `${member.name.slice(0, 11)}…` : member.name}
                      </text>
                    </g>
                  )
                })}

                <g transform="translate(-14, -22)">
                  <BeeIcon color="#f59e0b" crowned width={28} height={28} />
                </g>
                <text
                  x={0}
                  y={16}
                  textAnchor="middle"
                  className="fill-foreground text-[10px] font-semibold"
                >
                  {t('swarmBoard.overview.coordinator')}
                </text>
                <text
                  x={0}
                  y={28}
                  textAnchor="middle"
                  className="fill-muted-foreground font-mono text-[9px]"
                >
                  {doneTasks} of {totalTasks} done
                </text>
              </g>
            ) : (
              <g>
                {renderMemberEdges(mentionNodeMap)}
                {mentionNodes.map((node) => {
                  const palette = getMemberPalette(node.name, memberColorMap[node.name.toLowerCase()])
                  const isCoord = node.name === 'coordinator'
                  const isSender = latestMessage?.agent === node.name
                  const done = isTaskDoneForMember(node.name, visibleMessages, membersByName)
                  return (
                    <g key={node.name} transform={`translate(${node.x - 14}, ${node.y - 14})`}>
                      {isSender && (
                        <circle
                          cx={14}
                          cy={14}
                          r={18}
                          fill="none"
                          stroke="#f59e0b"
                          strokeWidth={1.6}
                          strokeOpacity={0.75}
                        />
                      )}
                      <BeeIcon color={palette.hex} crowned={isCoord} width={28} height={28} />
                      {!isCoord && (
                        <circle cx={26} cy={3} r={3} fill={done ? '#10b981' : '#f59e0b'} />
                      )}
                      <text
                        x={14}
                        y={39}
                        textAnchor="middle"
                        className="fill-muted-foreground text-[10px] font-medium"
                      >
                        @{node.name}
                      </text>
                    </g>
                  )
                })}
              </g>
            )}
          </svg>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 bg-emerald-500" />
          {t('swarmBoard.graph.tasksDoneLegend')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 bg-amber-500" />
          {t('swarmBoard.graph.messageSentLegend')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 border-t border-dashed border-muted-foreground" />
          {t('swarmBoard.graph.waitingOnLegend')}
        </span>
      </div>
    </div>
  )
}
