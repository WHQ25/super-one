import { RealtimeDelegationStatus } from './RealtimeDelegationStatus'
export default { title: 'Chat/Realtime delegation status', component: RealtimeDelegationStatus }
const activity = { kind: 'codex' as const, status: 'working' as const, durationMs: null,
  workingSince: new Date(Date.now() - 12_000).toISOString(), messageIds: ['work'], turnIds: ['turn'],
  summary: null, plan: null, isTail: true }
export const Working = { args: { activity, onOpen: () => {} } }
export const Detail = { args: { activity: { ...activity, status: 'completed' as const, workingSince: null }, onOpen: () => {} } }
