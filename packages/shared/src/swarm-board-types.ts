export interface SwarmBoardMeta {
  version?: number
  backend?: string
  swarmId: string
  createdAt?: string
}

export interface SwarmBoardPlanGoal {
  title?: string
  line?: string
}

export interface SwarmBoardPlanThread {
  id: string
  title: string
  goal?: string
  tasks: string[]
}

export interface SwarmBoardPlan {
  goal?: SwarmBoardPlanGoal
  tasks?: Record<string, string>
  threads?: SwarmBoardPlanThread[]
}

export interface SwarmBoardMember {
  name: string
  conversationId: string
  role: 'coordinator' | 'worker'
  model?: string
  phase?: string
  wakeMode?: string
  waitSince?: number
  lastReadSeq?: number
  killed: boolean
  isWorking: boolean
  taskDescription?: string
  currentAction?: string
  lastPostText?: string
  lastPostSeq?: number
}

export interface SwarmBoardMessage {
  seq: number
  agent: string
  text: string
  time?: string
  kind?: string
  channel?: string
  mentions: string[]
  isDone: boolean
}

export interface SwarmBoardSnapshot {
  sessionId: string
  title: string
  isLive: boolean
  meta?: SwarmBoardMeta
  plan?: SwarmBoardPlan
  members: SwarmBoardMember[]
  messages: SwarmBoardMessage[]
  headSeq: number
}

export type SwarmBoardReadResult =
  | { ok: true; snapshot: SwarmBoardSnapshot }
  | { ok: false; reason: 'absent' | 'error'; error?: string }
