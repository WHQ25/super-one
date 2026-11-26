import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { BeeIcon } from '@superone/chat-view/presenters/SubagentBlock'
import type { SwarmBoardSnapshot } from '@superone/shared/swarm-board-types'
import { cn } from '@superone/ui/lib/utils'
import {
  streamdownComponents,
  streamdownControls,
  streamdownLinkSafety,
  streamdownPlugins,
  streamdownRehypePlugins,
} from '@/components/chat/chat-shared'
import {
  computeSwarmProgress,
  getMemberPalette,
  isTaskDoneForMember,
} from './swarm-board-utils'

interface SwarmGraphTabProps {
  snapshot: SwarmBoardSnapshot
  memberColorMap?: Record<string, number>
}

type GraphMode = 'hive' | 'mentions'
type PlaybackSpeed = 0.5 | 1 | 2

const HEX_R = 62
const HEX_GAP = 1.15
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

function ProgressHexagon({
  cx,
  cy,
  r,
  done,
  total,
  highlighted,
}: {
  cx: number
  cy: number
  r: number
  done: number
  total: number
  highlighted: boolean
}) {
  const pts = hexPoints(cx, cy, r)
  const perimeter = 6 * r
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0
  const dashLen = perimeter * ratio

  return (
    <g>
      <polygon
        points={pts}
        fill="rgba(148, 163, 184, 0.05)"
        stroke={highlighted ? '#f59e0b' : '#94a3b8'}
        strokeOpacity={highlighted ? 0.65 : 0.35}
        strokeWidth={1.6}
      />
      {ratio > 0 && (
        <polygon
          points={pts}
          fill="none"
          stroke="#22c55e"
          strokeWidth={1.8}
          strokeDasharray={`${dashLen.toFixed(1)} ${perimeter.toFixed(1)}`}
          strokeLinecap="round"
        />
      )}
    </g>
  )
}

export function SwarmGraphTab({ snapshot, memberColorMap = {} }: SwarmGraphTabProps) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<GraphMode>('hive')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const totalPosts = snapshot.messages.length
  const [cursor, setCursor] = useState<number>(totalPosts)

  useEffect(() => {
    if (!playing) {
      setCursor(totalPosts)
    }
  }, [totalPosts, playing])

  useEffect(() => {
    if (!playing || totalPosts === 0) return
    const ms = speed === 2 ? 450 : speed === 0.5 ? 1600 : 900
    const timer = setInterval(() => {
      setCursor((prev) => {
        if (prev >= totalPosts) {
          setPlaying(false)
          return totalPosts
        }
        return prev + 1
      })
    }, ms)
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
  const { doneTasks, totalTasks, threads } = useMemo(
    () => computeSwarmProgress(slicedSnapshot),
    [slicedSnapshot],
  )
  const membersByName = useMemo(
    () => new Map(snapshot.members.map((m) => [m.name, m])),
    [snapshot.members],
  )
  const workers = useMemo(
    () => snapshot.members.filter((m) => m.role !== 'coordinator'),
    [snapshot.members],
  )

  const hiveWorkspaces = useMemo(() => {
    if (threads.length > 0) return threads
    if (workers.length === 0) return []
    return [
      {
        id: 'default-workspace',
        title: snapshot.title,
        tasks: workers.map((w) => w.name),
        doneCount: doneTasks,
        totalCount: workers.length,
        isDone: workers.length > 0 && doneTasks >= workers.length,
      },
    ]
  }, [threads, workers, snapshot.title, doneTasks])

  const hiveLayout = useMemo(() => {
    const workspaceCenters = new Map<string, { x: number; y: number }>()
    const memberCoords = new Map<string, { x: number; y: number }>()
    memberCoords.set('coordinator', { x: 0, y: 0 })

    const offsets = generateAxialSpiral(hiveWorkspaces.length)
    const stepRadius = HEX_R * HEX_GAP
    hiveWorkspaces.forEach((ws, idx) => {
      const offset = offsets[idx]
      if (!offset) return
      const center = axialToPixel(offset[0], offset[1], 0, 0, stepRadius)
      workspaceCenters.set(ws.id, center)
      const cols = Math.min(ws.tasks.length, 3)
      ws.tasks.slice(0, 6).forEach((name, mIdx) => {
        const row = Math.floor(mIdx / 3)
        const col = mIdx % 3
        const rowCount = row === 0 ? cols : Math.min(3, ws.tasks.length - 3)
        const ox = (col - (rowCount - 1) / 2) * 34
        const oy = ws.tasks.length > 3 ? (row === 0 ? 0 : 26) : 12
        memberCoords.set(name, { x: center.x + ox, y: center.y + oy })
      })
    })
    return { workspaceCenters, memberCoords }
  }, [hiveWorkspaces])

  const hiveViewBox = useMemo(() => {
    let minX = -HEX_R
    let maxX = HEX_R
    let minY = -HEX_R
    let maxY = HEX_R
    for (const pos of hiveLayout.workspaceCenters.values()) {
      minX = Math.min(minX, pos.x - HEX_R)
      maxX = Math.max(maxX, pos.x + HEX_R)
      minY = Math.min(minY, pos.y - HEX_R)
      maxY = Math.max(maxY, pos.y + HEX_R)
    }
    const pad = 22
    const width = Math.max(320, maxX - minX + pad * 2)
    const height = Math.max(260, maxY - minY + pad * 2)
    return `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`
  }, [hiveLayout])

  const mentionNodes = useMemo(() => {
    const hasCoordinator = snapshot.members.some((m) => m.role === 'coordinator')
    const cx = 240
    const cy = 175
    const radius = workers.length > 8 ? 135 : 115
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
        const pad = 16
        const x1 = from.x + (dx / len) * pad
        const y1 = from.y + (dy / len) * pad
        const x2 = to.x - (dx / len) * pad
        const y2 = to.y - (dy / len) * pad
        const mx = (x1 + x2) / 2 - (dy / len) * 18
        const my = (y1 + y2) / 2 + (dx / len) * 18
        return (
          <path
            key={`${msg.seq}-${target}`}
            d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
            fill="none"
            stroke={isLatest ? '#60a5fa' : 'currentColor'}
            strokeOpacity={isLatest ? 0.95 : 0.16}
            strokeWidth={isLatest ? 1.8 : 1}
            strokeDasharray={isLatest ? undefined : '3 3'}
            markerEnd={isLatest ? 'url(#swarm-arrow-active)' : 'url(#swarm-arrow-muted)'}
          />
        )
      })
    })
  }

  const cycleSpeed = () => {
    setSpeed((s) => (s === 0.5 ? 1 : s === 1 ? 2 : 0.5))
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
            {effectiveCursor} of {totalPosts}
            {latestMessage ? ` · #${latestMessage.seq}` : ''}
            {latestMessage?.time ? ` at ${latestMessage.time.split(' ')[1] ?? latestMessage.time}` : ''}
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
              onClick={cycleSpeed}
              className="rounded-md border border-border/70 px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {speed}x
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col items-center justify-center">
          <svg
            viewBox={mode === 'hive' ? hiveViewBox : '0 0 480 350'}
            className="max-h-[340px] w-full"
          >
            <defs>
              <marker id="swarm-arrow-active" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#60a5fa" />
              </marker>
              <marker id="swarm-arrow-muted" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                <path d="M0,0 L5,2.5 L0,5 Z" fill="currentColor" fillOpacity="0.3" />
              </marker>
            </defs>

            {mode === 'hive' ? (
              <g>
                <ProgressHexagon
                  cx={0}
                  cy={0}
                  r={HEX_R}
                  done={doneTasks}
                  total={totalTasks}
                  highlighted={latestMessage?.agent === 'coordinator'}
                />

                {hiveWorkspaces.map((ws) => {
                  const center = hiveLayout.workspaceCenters.get(ws.id)
                  if (!center) return null
                  const hasLatestSender = Boolean(latestMessage && ws.tasks.includes(latestMessage.agent))
                  return (
                    <g key={ws.id}>
                      <ProgressHexagon
                        cx={center.x}
                        cy={center.y}
                        r={HEX_R}
                        done={ws.doneCount}
                        total={ws.totalCount}
                        highlighted={hasLatestSender}
                      />
                      <text
                        x={center.x}
                        y={center.y - 31}
                        textAnchor="middle"
                        className="fill-foreground text-[9.5px] font-semibold"
                      >
                        {ws.title.length > 18 ? `${ws.title.slice(0, 17)}…` : ws.title}
                      </text>
                      <text
                        x={center.x}
                        y={center.y - 19}
                        textAnchor="middle"
                        className="fill-muted-foreground font-mono text-[8.5px]"
                      >
                        {ws.doneCount}/{ws.totalCount}
                      </text>
                    </g>
                  )
                })}

                {renderMemberEdges(hiveLayout.memberCoords)}

                {hiveWorkspaces.map((ws) =>
                  ws.tasks.slice(0, 6).map((taskName) => {
                    const pos = hiveLayout.memberCoords.get(taskName)
                    if (!pos) return null
                    const palette = getMemberPalette(taskName, memberColorMap[taskName.toLowerCase()])
                    const done = isTaskDoneForMember(taskName, visibleMessages, membersByName)
                    return (
                      <g key={`${ws.id}-${taskName}`} transform={`translate(${pos.x - 12}, ${pos.y - 12})`}>
                        <BeeIcon color={palette.hex} width={24} height={24} />
                        <circle cx={22} cy={3} r={2.8} fill={done ? '#22c55e' : '#f59e0b'} />
                        <text
                          x={12}
                          y={33}
                          textAnchor="middle"
                          className="fill-muted-foreground text-[8.5px]"
                        >
                          {taskName.length > 10 ? `${taskName.slice(0, 9)}…` : taskName}
                        </text>
                      </g>
                    )
                  }),
                )}

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
                          stroke="#60a5fa"
                          strokeWidth={1.6}
                          strokeOpacity={0.75}
                        />
                      )}
                      <BeeIcon color={palette.hex} crowned={isCoord} width={28} height={28} />
                      {!isCoord && (
                        <circle cx={26} cy={3} r={3} fill={done ? '#22c55e' : '#f59e0b'} />
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

        <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-border/50 pt-2.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-emerald-500" />
            {t('swarmBoard.graph.tasksDoneLegend')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 bg-blue-400" />
            {t('swarmBoard.graph.messageSentLegend')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 border-t border-dashed border-muted-foreground" />
            {t('swarmBoard.graph.waitingOnLegend')}
          </span>
        </div>

        {latestMessage && (
          <div className="mt-3 rounded-xl border border-border/60 bg-card/40 p-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-foreground">{latestMessage.agent}</span>
              {latestMessage.mentions.length > 0 && (
                <>
                  <span className="text-muted-foreground">→</span>
                  <span className="truncate text-muted-foreground">
                    {latestMessage.mentions.map((m) => `@${m}`).join(' ')}
                  </span>
                </>
              )}
              {latestMessage.time && (
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                  {latestMessage.time.split(' ')[1] ?? latestMessage.time}
                </span>
              )}
            </div>
            <div className="mt-1.5 text-xs leading-relaxed text-foreground/90">
              <Streamdown
                className="chat-md text-xs"
                plugins={streamdownPlugins}
                rehypePlugins={streamdownRehypePlugins}
                components={streamdownComponents}
                controls={streamdownControls}
                linkSafety={streamdownLinkSafety}
              >
                {latestMessage.text}
              </Streamdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
