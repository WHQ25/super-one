import type { Meta, StoryObj } from '@storybook/react'
import type { SwarmBoardSnapshot } from '@superone/shared/swarm-board-types'
import { SwarmBoardPanel } from './SwarmBoardPanel'

const liveSnapshot: SwarmBoardSnapshot = {
  sessionId: 'demo-swarm-session',
  title: 'BLACK-SAIL Storm System',
  isLive: true,
  headSeq: 10,
  plan: {
    goal: {
      title: 'Add BLACK-SAIL Storm System',
      line: 'WeatherManager, storm waves, wind sailing, rain/fog/audio FX, HUD wind dial.',
    },
    tasks: {
      weather: 'Create WeatherManager autoload with 20s Calm/Storm blend',
      ocean: 'Wire wave_scale uniform into ocean shader and sync buoyancy',
      sailing: 'Add wind-relative speed and storm roll to Ship',
      verifier: 'Verify file ownership, headless parse/load, and autotests',
    },
    threads: [
      {
        id: 't-core',
        title: 'Weather Core & Ocean Waves',
        goal: 'Smooth 20s Calm/Storm state driving synchronized GPU and CPU wave scaling.',
        tasks: ['weather', 'ocean'],
      },
      {
        id: 't-verify',
        title: 'Wind Sailing & Verification',
        goal: 'Ships react to wind and storms while verifier validates all checks.',
        tasks: ['sailing', 'verifier'],
      },
    ],
  },
  members: [
    {
      name: 'coordinator',
      conversationId: 'c-coord',
      role: 'coordinator',
      model: 'gemini-4-hydrogen-medium',
      killed: false,
      isWorking: false,
      lastReadSeq: 10,
      lastPostSeq: 7,
      lastPostText: 'All workers assigned; monitor watching for stalls.',
    },
    {
      name: 'weather',
      conversationId: 'c-weather',
      role: 'worker',
      model: 'gemini-4-hydrogen-medium',
      killed: false,
      isWorking: false,
      taskDescription: 'Create WeatherManager autoload with 20s Calm/Storm blend',
      lastPostSeq: 8,
      lastPostText: '[done] Implemented WeatherManager autoload and registered it in project.godot.',
    },
    {
      name: 'ocean',
      conversationId: 'c-ocean',
      role: 'worker',
      model: 'gemini-4-hydrogen-medium',
      killed: false,
      isWorking: false,
      taskDescription: 'Wire wave_scale uniform into ocean shader and sync buoyancy',
      lastPostSeq: 9,
      lastPostText: '[done] Wired ocean shader and wave buoyancy to WeatherManager.wave_scale.',
    },
    {
      name: 'sailing',
      conversationId: 'c-sailing',
      role: 'worker',
      model: 'gemini-4-hydrogen-medium',
      killed: false,
      isWorking: false,
      taskDescription: 'Add wind-relative speed and storm roll to Ship',
      lastPostSeq: 10,
      lastPostText: '[done] Updated ship handling in scripts/ship/ship.gd.',
    },
    {
      name: 'verifier',
      conversationId: 'c-verifier',
      role: 'worker',
      model: 'gemini-4-hydrogen-medium',
      killed: false,
      isWorking: true,
      taskDescription: 'Verify file ownership, headless parse/load, and autotests',
      currentAction: 'Read scripts/core/weather_manager.gd',
    },
  ],
  messages: [
    {
      seq: 1,
      agent: 'coordinator',
      text: '@weather Create WeatherManager autoload with 20s Calm/Storm blend.',
      time: '2026-11-26 12:35:00',
      kind: 'brief',
      mentions: ['weather'],
      isDone: false,
    },
    {
      seq: 8,
      agent: 'weather',
      text: '@verifier [done] Implemented WeatherManager autoload and registered it in project.godot.',
      time: '2026-11-26 12:37:12',
      mentions: ['verifier'],
      isDone: true,
    },
    {
      seq: 9,
      agent: 'ocean',
      text: '@verifier [done] Wired ocean shader and wave buoyancy to WeatherManager.wave_scale.',
      time: '2026-11-26 12:38:05',
      mentions: ['verifier'],
      isDone: true,
    },
    {
      seq: 10,
      agent: 'sailing',
      text: '@verifier [done] Updated ship handling in scripts/ship/ship.gd.',
      time: '2026-11-26 12:39:18',
      mentions: ['verifier'],
      isDone: true,
    },
  ],
}

const meta: Meta<typeof SwarmBoardPanel> = {
  title: 'Activity/SwarmBoardPanel',
  component: SwarmBoardPanel,
  decorators: [
    (Story) => (
      <div className="h-[680px] w-[520px] border border-border bg-background">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof SwarmBoardPanel>

export const Live: Story = {
  args: {
    sessionId: 'demo-swarm-session',
    initialSnapshot: liveSnapshot,
  },
}

export const Completed: Story = {
  args: {
    sessionId: 'demo-swarm-session',
    initialSnapshot: {
      ...liveSnapshot,
      isLive: false,
      members: liveSnapshot.members.map((m) => ({ ...m, isWorking: false, currentAction: undefined })),
      messages: [
        ...liveSnapshot.messages,
        {
          seq: 11,
          agent: 'verifier',
          text: '@coordinator [done] All checks pass.',
          time: '2026-11-26 12:40:02',
          mentions: ['coordinator'],
          isDone: true,
        },
      ],
      headSeq: 11,
    },
  },
}

export const Empty: Story = {
  args: {
    sessionId: 'empty-session',
    initialSnapshot: null,
  },
}

export const NarrowLayout: Story = {
  args: {
    sessionId: 'demo-swarm-session',
    initialSnapshot: liveSnapshot,
  },
  decorators: [
    (Story) => (
      <div className="h-[640px] w-[340px] border border-border bg-background">
        <Story />
      </div>
    ),
  ],
}
