import React, { useState } from 'react'
import { ClaudeSessionIcon } from '@superone/ui/components/harness/ClaudeSessionIcon'
import { CodexSessionIcon } from '@superone/ui/components/harness/CodexSessionIcon'

export default {
  title: 'Harness/SessionIcons',
}

export function IconsShowcase() {
  const [active, setActive] = useState(false)
  const [zoom, setZoom] = useState(8)

  const states = [
    { key: 'default', name: 'Default (闲置)', desc: '100% 还原原版设计。Claude 经典浮动与慢眨眼；Codex 神经元渐变、光标慢闪与微小起伏。' },
    { key: 'running', name: 'Running (流式思考)', desc: '极速计算。Claude 缩小主体做优雅大动作平跳，底部键帽高频闪烁，大眼急速眨眼；Codex 100% 完美呈现彩虹渐变云朵，底色流光溢彩流淌，内部光标高频闪烁，同时右侧浮现 3 行向右极速横向平移淡出的多彩微型代码粒子（亮白、冰蓝、极光粉），极富空气流动感，云朵品牌认知度与 Premium 科技感无懈可击！' },
    { key: 'background', name: 'Background (后台休眠)', desc: '后台守候。Claude 主体降暗，眼睛紧闭成单线，胸腔正中单像素幽蓝色呼吸灯闪动；Codex 整体低频幽蓝平滑淡入淡出。' },
    { key: 'unseen', name: 'Unseen (未读完成)', desc: '任务大捷。Claude 保持原貌，两只眼睛切换为亮翠绿色并慢速呼吸闪烁；Codex 云朵中心的命令行提示符与光标切换为绿色。' },
    { key: 'automation', name: 'Automation (自动化)', desc: '定时计划。Claude 主体完全不动，额头上方单像素黄色指示灯以 1.2s 规律性闪烁；Codex 命令行右侧极小黄色星子做圆周匀速自转。' },
  ] as const

  const checkerStyle: React.CSSProperties = {
    background:
      'linear-gradient(45deg, var(--muted) 25%, transparent 25%), linear-gradient(-45deg, var(--muted) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--muted) 75%), linear-gradient(-45deg, transparent 75%, var(--muted) 75%)',
    backgroundSize: '8px 8px',
    backgroundColor: 'var(--background)',
  }

  return (
    <div className="min-h-screen p-8 bg-background text-foreground font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text bg-gradient-to-r from-orange-500 via-sky-500 to-indigo-500 text-transparent">
            Harness Session Status Icons (V5 - Ultimate Minimalist)
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            为了在 12px 极小空间中常驻侧边栏时保持极致干净与 premium 质感，主体 100% 保持 default，仅通过微米级单像素动态传达状态，拒绝一切视觉噪点。
          </p>
        </div>

        <div className="flex flex-wrap gap-4 items-center bg-card/80 border border-border p-4 rounded-xl backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">侧边栏行状态:</span>
            <button
              onClick={() => setActive(!active)}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-all border ${
                active
                  ? 'bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/50 shadow-lg shadow-orange-500/10'
                  : 'bg-secondary text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              {active ? '已激活 (Active)' : '常规 (Normal)'}
            </button>
          </div>

          <div className="h-4 w-px bg-border" />

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">微观放大倍率:</span>
            <input
              type="range"
              min="4"
              max="16"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-32 accent-sky-500"
            />
            <span className="text-xs font-mono text-sky-600 dark:text-sky-400 w-8">{zoom}x</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-500 shadow-md shadow-orange-500/20" />
              <h2 className="text-lg font-bold text-orange-600 dark:text-orange-400">Claude Code (像素机器人)</h2>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {states.map((state) => (
                <div
                  key={state.key}
                  className="flex items-center justify-between p-4 bg-card border border-border hover:border-orange-500/30 rounded-xl transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="flex items-center justify-center border border-border rounded-lg p-2 transition-all relative overflow-hidden"
                      style={{
                        width: `${zoom * 12 + 16}px`,
                        height: `${zoom * 12 + 16}px`,
                        ...checkerStyle,
                      }}
                    >
                      <div
                        style={{
                          transform: `scale(${zoom})`,
                          transformOrigin: 'center center',
                          imageRendering: 'pixelated',
                        }}
                      >
                        <ClaudeSessionIcon status={state.key} active={active} />
                      </div>
                    </div>

                    <div>
                      <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                        {state.name}
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-secondary font-mono text-muted-foreground">
                          {state.key}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 max-w-sm leading-relaxed">{state.desc}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 bg-background/80 px-4 py-2 border border-border/80 rounded-lg shrink-0 w-32">
                    <ClaudeSessionIcon status={state.key} active={active} />
                    <span className="text-xs truncate font-medium text-foreground">
                      {active ? 'Active Title' : 'Session Title'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-md shadow-sky-500/20" />
              <h2 className="text-lg font-bold text-sky-600 dark:text-sky-400">Codex (神经元云朵)</h2>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {states.map((state) => (
                <div
                  key={state.key}
                  className="flex items-center justify-between p-4 bg-card border border-border hover:border-sky-500/30 rounded-xl transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="flex items-center justify-center border border-border rounded-lg p-2 transition-all relative overflow-hidden"
                      style={{
                        width: `${zoom * 12 + 16}px`,
                        height: `${zoom * 12 + 16}px`,
                        ...checkerStyle,
                      }}
                    >
                      <div
                        style={{
                          transform: `scale(${zoom})`,
                          transformOrigin: 'center center',
                        }}
                      >
                        <CodexSessionIcon status={state.key} active={active} />
                      </div>
                    </div>

                    <div>
                      <div className="text-sm font-semibold text-foreground flex items-center gap-2">
                        {state.name}
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-secondary font-mono text-muted-foreground">
                          {state.key}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 max-w-sm leading-relaxed">{state.desc}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 bg-background/80 px-4 py-2 border border-border/80 rounded-lg shrink-0 w-32">
                    <CodexSessionIcon status={state.key} active={active} />
                    <span className="text-xs truncate font-medium text-foreground">
                      {active ? 'Active Title' : 'Session Title'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
