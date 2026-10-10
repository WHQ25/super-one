import { controlLeaseAuthority } from '../control-lease.test-fixtures'
import { TerminalLease } from './terminal-lease'
export const terminalLeaseAuthority = controlLeaseAuthority
export function terminalLease(terminalId = 't'): TerminalLease { return new TerminalLease(controlLeaseAuthority(), terminalId) }
