import { describe, expect, it } from 'vitest'
import { applyEventToSession, createDefaultChatCoreSession } from '@superone/chat-core'
import { acpEffortOptionsForModel, acpModeCatalog } from '@superone/shared/harness/acp-mode-catalog'
import { deriveSessionCatalog, extractModelsFromNewSessionResult, extractModesFromNewSessionResult } from './acp-config'
import { acpAntigravityStrategy } from '../../renderer/src/harness-ui/acp/strategy'
import { resolveAcpModeForModelSwitch } from '../../renderer/src/stores/chat-store/harness/acp-handler'

const AGY_1_5_9_SESSION_NEW = {
  sessionId: 'agy-159',
  configOptions: [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: 'gemini-4-hydrogen',
      options: [
        { value: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
        { value: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
        { value: 'gemini-4-argon', name: 'Gemini 4 Argon' },
        { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
        { value: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
        { value: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
        { value: 'gemini-pro-orchestrator', name: 'Gemini Pro Orchestrator' },
        { value: 'gemini-pro-orchestrator-argon', name: 'Gemini Pro Orchestrator Argon' },
        { value: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B Medium' },
      ],
    },
    {
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: 'default',
      options: [
        { value: 'default', name: 'Default' },
        { value: 'accept-edits', name: 'Accept Edits' },
        { value: 'auto', name: 'Auto' },
        { value: 'plan', name: 'Plan' },
      ],
    },
    {
      id: 'thought_level',
      name: 'Thinking Level',
      category: 'thought_level',
      type: 'select',
      currentValue: 'xhigh',
      options: [
        { value: 'low', name: 'Low' },
        { value: 'medium', name: 'Medium' },
        { value: 'high', name: 'High' },
        { value: 'xhigh', name: 'Extra' },
      ],
    },
  ],
  models: {
    currentModelId: 'gemini-4-hydrogen-xhigh',
    availableModels: [
      ...['low', 'medium', 'high', 'xhigh'].map((t) => ({ modelId: `gemini-4-hydrogen-${t}`, name: `Hydrogen ${t}` })),
      ...['gemini-4-carbon', 'gemini-4-argon', 'gemini-3.8-flash', 'claude-opus-5-5', 'claude-sonnet-5-5'].flatMap((base) =>
        ['low', 'medium', 'high'].map((t) => ({ modelId: `${base}-${t}`, name: `${base} ${t}` })),
      ),
      { modelId: 'gemini-pro-orchestrator', name: 'Gemini Pro Orchestrator' },
      { modelId: 'gemini-pro-orchestrator-argon', name: 'Gemini Pro Orchestrator Argon' },
      { modelId: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B Medium' },
    ],
  },
}

describe('Antigravity 1.5.9 per-model effort catalog and clamping', () => {
  it('derives 4-level, 3-level, and 0-level effort support across agy 1.5.9 models and ignores permission mode select', () => {
    const modelCfg = extractModelsFromNewSessionResult(AGY_1_5_9_SESSION_NEW)
    const modeCfg = extractModesFromNewSessionResult(AGY_1_5_9_SESSION_NEW)
    expect(modeCfg?.configId).toBe('thought_level')
    expect(modeCfg?.modes.map((m) => m.id)).toEqual(['low', 'medium', 'high', 'xhigh'])

    const byId = new Map(modelCfg?.models.map((m) => [m.id, m]))
    expect(byId.get('gemini-4-hydrogen')?.supportedEffortLevels).toEqual(['low', 'medium', 'high', 'xhigh'])
    for (const id of ['gemini-4-carbon', 'gemini-4-argon', 'gemini-3.8-flash', 'claude-opus-5-5', 'claude-sonnet-5-5']) {
      expect(byId.get(id)?.supportsEffort).toBe(true)
      expect(byId.get(id)?.supportedEffortLevels).toEqual(['low', 'medium', 'high'])
    }
    for (const id of ['gemini-pro-orchestrator', 'gemini-pro-orchestrator-argon', 'gpt-oss-120b-medium']) {
      expect(byId.get(id)?.supportsEffort).toBe(false)
      expect(byId.get(id)?.supportedEffortLevels).toEqual([])
    }

    const zeroEffortSessionNew = {
      sessionId: 'agy-orch',
      configOptions: AGY_1_5_9_SESSION_NEW.configOptions.filter((opt) => opt.id !== 'thought_level'),
      models: AGY_1_5_9_SESSION_NEW.models,
    }
    expect(extractModesFromNewSessionResult(zeroEffortSessionNew)).toBeNull()
  })

  it('clamps selectedAcpModeId and draftSettings when switching between 4-tier, 3-tier, and 0-tier models', () => {
    const modelCfg = extractModelsFromNewSessionResult(AGY_1_5_9_SESSION_NEW)!
    const modeCfg = extractModesFromNewSessionResult(AGY_1_5_9_SESSION_NEW)!
    const sessionCatalog = deriveSessionCatalog({
      configOptions: AGY_1_5_9_SESSION_NEW.configOptions as never,
      extraModels: AGY_1_5_9_SESSION_NEW.models.availableModels.map((m) => ({
        id: m.modelId,
        name: m.name,
        description: '',
      })),
      updatedAt: '2026-11-16T00:00:00.000Z',
    })

    const modeEfforts = acpModeCatalog({
      modes: sessionCatalog.modes,
      modeConfigId: sessionCatalog.modeConfigId,
      selectedModeId: sessionCatalog.selectedModeId,
    }).efforts

    expect(acpEffortOptionsForModel(sessionCatalog.models, 'gemini-4-hydrogen', modeEfforts).map((e) => e.value))
      .toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(acpEffortOptionsForModel(sessionCatalog.models, 'gemini-4-carbon', modeEfforts).map((e) => e.value))
      .toEqual(['low', 'medium', 'high'])
    expect(acpEffortOptionsForModel(sessionCatalog.models, 'gemini-pro-orchestrator', modeEfforts))
      .toEqual([])

    const baseSession = {
      acpModels: modelCfg.models,
      acpModes: modeCfg.modes,
      acpModeConfigId: modeCfg.configId,
      selectedAcpModeId: 'xhigh',
      selectedModel: 'gemini-4-hydrogen',
      selectedAcpContextWindow: null,
    }

    expect(resolveAcpModeForModelSwitch(baseSession, 'gemini-4-carbon')).toEqual({
      nextModeId: 'high',
      changed: true,
    })
    expect(resolveAcpModeForModelSwitch(baseSession, 'gemini-pro-orchestrator')).toEqual({
      nextModeId: null,
      changed: true,
    })

    expect(acpAntigravityStrategy.draftSettings({
      ...baseSession,
      selectedModel: 'gemini-pro-orchestrator',
      selectedAcpModeId: 'xhigh',
    } as never)).toEqual({})

    expect(acpAntigravityStrategy.draftSettings({
      ...baseSession,
      selectedModel: 'gemini-4-carbon',
      selectedAcpModeId: 'xhigh',
    } as never)).toEqual({ mode: 'high' })

    let chat = {
      ...createDefaultChatCoreSession(),
      preferredProvider: 'acp-antigravity' as const,
      acpAgentId: 'antigravity',
    }
    chat = {
      ...chat,
      ...applyEventToSession(chat, {
        type: 'acp_modes',
        agentId: 'antigravity',
        configId: 'thought_level',
        selectedModeId: 'xhigh',
        modes: modeCfg.modes,
      }),
    }
    chat = {
      ...chat,
      ...applyEventToSession(chat, {
        type: 'acp_models',
        agentId: 'antigravity',
        configId: 'model',
        selectedModelId: 'gemini-4-carbon',
        models: modelCfg.models,
      }),
    }
    expect(chat.selectedAcpModeId).toBe('high')

    const switchedToOrchestrator = {
      ...chat,
      selectedModel: 'gemini-pro-orchestrator',
    }
    chat = {
      ...switchedToOrchestrator,
      ...applyEventToSession(switchedToOrchestrator, {
        type: 'acp_models',
        agentId: 'antigravity',
        configId: 'model',
        selectedModelId: 'gemini-pro-orchestrator',
        models: modelCfg.models,
      }),
    }
    expect(chat.selectedAcpModeId).toBeNull()
  })
})
