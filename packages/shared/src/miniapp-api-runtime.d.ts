import type { SuperOne, SuperOneSelfApi, SuperOneLocale } from './miniapp-author-api'

export type {
  SuperOneLocale as MiniAppLocale,
  SuperOnePopoverHandle as PopoverHandle,
  SuperOnePopoverApi as PopoverApi,
  SuperOneToolInterceptApi as ToolInterceptApi,
  SuperOneToolResultApi as ToolResultApi,
  SuperOneToolStandaloneApi as ToolStandaloneApi,
  SuperOneToolRendererApi as ToolRendererApi,
  SuperOneDb as SuperoneDbApi,
  SuperOneKv as SuperoneKvApi,
  SuperOne as SuperoneApi,
  SuperOneSelfApi,
} from './miniapp-author-api'

export interface MiniAppTransport {
  send(type: string, data: Record<string, unknown>): void
  request(reqType: string, resType: string, data: Record<string, unknown>, resultKey?: string): Promise<unknown>
  on(type: string, handler: (data: Record<string, unknown>) => void): void
}

export function createSuperoneApi(transport: MiniAppTransport, version: string, opts?: { initialLocale?: SuperOneLocale }): SuperOne
export function createSuperoneSelf(transport: MiniAppTransport): SuperOneSelfApi
export function startSuperoneResize(transport: MiniAppTransport): void
export function installSuperoneMediaProbe(transport: MiniAppTransport): void
