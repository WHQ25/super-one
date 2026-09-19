import { describe, expect, it } from 'vitest'
import { claudeThirdPartyEnv } from './claude-env'

describe('claudeThirdPartyEnv', () => {
  it('denies mid-conversation tool changes on an Anthropic-compatible host', () => {
    expect(claudeThirdPartyEnv({ brand: 'bailian' })).toEqual({
      CLAUDE_CODE_MODEL_CAPABILITIES: '-mid_conv_tool_change',
    })
    expect(claudeThirdPartyEnv({ brand: 'my-custom-relay' })).toEqual({
      CLAUDE_CODE_MODEL_CAPABILITIES: '-mid_conv_tool_change',
    })
  })

  it('leaves backends Claude Code recognises alone', () => {
    for (const brand of ['anthropic', 'claude', 'bedrock', 'vertexai']) {
      expect(claudeThirdPartyEnv({ brand })).toEqual({})
    }
  })
})
