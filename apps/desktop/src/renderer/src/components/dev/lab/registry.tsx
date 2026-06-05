import type React from 'react'
import { HarnessAnimBench } from '../HarnessAnimBench'

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
]
