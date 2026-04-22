const PROCESS_EPOCH = Date.now()
let counter = 0

export function nextEventSeq(): { epoch: number; seq: number } {
  return { epoch: PROCESS_EPOCH, seq: ++counter }
}

export function getProcessEpoch(): number {
  return PROCESS_EPOCH
}
