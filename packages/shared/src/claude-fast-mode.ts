import type { ModelOption, ProviderModelEnv } from './agent-types'

/** Model support comes from the SDK; account availability is reported separately at runtime. */
export function supportsClaudeFastMode(model: Pick<ModelOption, 'supportsFastMode'> | null | undefined, modelEnv?: ProviderModelEnv | null): boolean {
  // A credential mapping replaces the catalog model, so its capability is unknown.
  return !Object.keys(modelEnv ?? {}).length && model?.supportsFastMode === true
}

export function claudeFastModeOption(on: boolean) {
  return { id: 'claudeFastMode', label: 'Fast mode', kind: 'toggle' as const,
    values: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }], selected: on ? 'true' : 'false' }
}
