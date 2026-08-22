import type { SuperOne, SuperOneLocale } from './miniapp-author-api'

export type {
  SuperOneLocale as MiniAppLocale,
  SuperOnePopoverHandle as PopoverHandle,
  SuperOnePopoverApi as PopoverApi,
  SuperOneToolInterceptApi as ToolInterceptApi,
  SuperOneToolResultApi as ToolResultApi,
  SuperOneToolStandaloneApi as ToolStandaloneApi,
  SuperOneToolRendererApi as ToolRendererApi,
  SuperOne as SuperoneApi,
} from './miniapp-author-api'

export interface MiniAppTransport {
  send(type: string, data: Record<string, unknown>): void
  request(reqType: string, resType: string, data: Record<string, unknown>, resultKey?: string): Promise<unknown>
  on(type: string, handler: (data: Record<string, unknown>) => void): void
}

export function createSuperoneApi(transport: MiniAppTransport, version: string, opts?: { initialLocale?: SuperOneLocale }): SuperOne
export function startSuperoneResize(transport: MiniAppTransport): void
export function installSuperoneMediaProbe(transport: MiniAppTransport): void
export function startSuperoneReady(transport: MiniAppTransport): void
