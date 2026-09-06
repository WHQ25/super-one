export type IconState = 'default' | 'running' | 'background' | 'unseen' | 'automation'
export type IconBrand = 'claude' | 'codex' | 'acp' | 'grok' | 'cursor' | 'opencode' | 'dsh'
export type ScaledLength = { multiplier: number; offset: number }
export type SceneStyle = Record<string, number | string | ScaledLength>
export type IconScene = { style: SceneStyle; animations: string[]; xml?: string; children?: IconScene[] }
export type MotionFrame = { at: number; opacity?: number; transform?: string }
export type IconMotion = { duration: number; easing: string; frames: MotionFrame[] }
export type HarnessSceneData = {
  scenes: Record<IconBrand, Record<IconState, Record<'compact' | 'rich', IconScene>>>
  motions: Record<string, IconMotion>
}
