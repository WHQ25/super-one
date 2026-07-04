import type React from 'react'
import { HarnessAnimBench } from '../HarnessAnimBench'
import { FireTextBench } from '../FireTextBench'
import { CanvasEditDiffBench } from '../CanvasEditDiffBench'

export interface Lab {
  id: string
  title: string
  description: string
  component: React.ComponentType
}

export const LABS: Lab[] = [
  {
    id: 'harness-anim',
    title: 'Harness Icons 动画性能',
    description: '对比 SVG-live / Sprite / DIV+CSS / 静止基线的 renderer·GPU·内存占用，自动跑批出表',
    component: HarnessAnimBench,
  },
  {
    id: 'fire-text',
    title: 'FireText 火焰徽章性能',
    description: '对比现行 rAF 粒子实现 vs 预渲染 sprite 条带 + CSS steps() 循环的 renderer·GPU 占用，自动跑批出表',
    component: FireTextBench,
  },
  {
    id: 'canvas-edit-diff',
    title: 'Edit/Write diff 稳态循环性能',
    description: '对比 CanvasEditDiff 打字机在流式完成后 常驻 rAF vs idle 节流+可见性门控 vs 静止基线 的 renderer·GPU 占用，自动跑批出表',
    component: CanvasEditDiffBench,
  },
]
