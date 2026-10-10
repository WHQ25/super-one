import type { PermissionMode, SandboxMode, SendMessageRequest } from '@superone/shared/agent-types'
import type { SessionHostPort } from '@superone/runtime/server'
import type { NodeSessionSettings } from '@superone/runtime/session'
import type { Session } from '../session/types'
import { runFencedSessionControl } from '../session/control-context'
import { enqueueSessionQueueOp, queuedSteerCommand } from '../session/session-queue'
import log from '../logger'

export async function applyDesktopSessionSettings(session: Session, patch: NodeSessionSettings): Promise<void> {
  session.lease.assertMutation()
  if (patch.permissionMode != null) await session.setPermissionMode(patch.permissionMode as PermissionMode)
  if (patch.sandboxMode != null) await session.setSandboxMode(patch.sandboxMode as SandboxMode)
  session.lease.assertMutation()
  if (patch.apiProviderId !== undefined) session.setApiProviderId(patch.apiProviderId ?? null)
  if (patch.model !== undefined || patch.effort !== undefined || patch.mode !== undefined) {
    await session.setSelectedSettings({ model: patch.model, effort: patch.effort as SendMessageRequest['effort'] | null | undefined, mode: patch.mode })
  }
  session.lease.assertMutation()
  if (patch.agentPreset !== undefined) session.setAgentPreset(patch.agentPreset)
  if (patch.additionalDirectories !== undefined) await session.dispatchBackendCommand({ kind: 'session.set_additional_dirs', dirs: patch.additionalDirectories ?? [] })
}

/** Admission returns promptly while the accepted turn streams through the domain. */
export async function admitDesktopSessionSend(session: Session, request: SendMessageRequest, input: Parameters<SessionHostPort['send']>[0]): Promise<void> {
  await runFencedSessionControl(session.id, input.client.clientSessionId, input, () => new Promise<void>((resolve, reject) => {
    const steer = input.steer && input.clientMessageId ? queuedSteerCommand(session.snapshot.harnessId, input.clientMessageId, input.steer) : null
    if (input.steer && !steer) { reject(Object.assign(new Error('Queued steer is not supported on this harness'), { code: 'unsupported' })); return }
    const deliver = async () => {
      session.lease.assertMutation()
      let duplicate = false
      await session.send(request, { providerOrigin: 'remote', onAccepted: receipt => { duplicate = receipt?.duplicate === true; resolve() } })
      if (steer && !duplicate) {
        try { await session.dispatchBackendCommand(steer) }
        catch (error) { log.warn('[desktop-session-host] queued steer after send failed sid=%s: %s', session.id, error) }
      }
    }
    const queued = input.priority === 'next' || input.priority === 'later' || !!input.steer
    const sent = queued ? enqueueSessionQueueOp(session.id, deliver) : deliver()
    void sent.then(() => resolve(), reject)
  }))
}

export function desktopSendRequest(input: Parameters<SessionHostPort['send']>[0], harnessId: string): SendMessageRequest {
  const additionalDirs = Object.hasOwn(input, 'callerAdditionalDirectories') ? input.callerAdditionalDirectories : input.additionalDirectories
  if (input.steer && (!input.clientMessageId || !queuedSteerCommand(harnessId, input.clientMessageId, input.steer))) {
    throw Object.assign(new Error('Queued steer is not supported on this harness'), { code: 'unsupported' })
  }
  if (harnessId === 'codex' && input.collaborationMode != null && input.collaborationMode !== 'default' && input.collaborationMode !== 'plan') {
    throw Object.assign(new Error('Desktop Codex collaborationMode must be default|plan'), { code: 'invalid_argument' })
  }
  return {
    content: input.text,
    ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { effort: input.effort as SendMessageRequest['effort'] } : {}),
    ...(input.images?.length ? { images: input.images.map((image) => ({ mimeType: image.mimeType, base64: image.base64, name: image.name ?? 'Attachment', ...(image.id ? { id: image.id } : {}) })) } : {}),
    ...(additionalDirs ? { additionalDirs } : {}),
    ...(input.userMessageContent ? { userMessageContent: input.userMessageContent } : {}),
    ...(input.contexts ? { contexts: input.contexts } : {}),
    ...(input.ultracode !== undefined ? { ultracode: input.ultracode } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.inputRequest ? { inputRequest: input.inputRequest } : {}),
    ...(input.modelParams ? { cursor: { params: input.modelParams } } : {}),
    ...(harnessId === 'codex' ? { codex: {
      ...(input.turnKind === 'review' || input.turnKind === 'compact' ? { mode: input.turnKind } : {}),
      ...(input.effort ? { reasoningEffort: input.effort as NonNullable<SendMessageRequest['codex']>['reasoningEffort'] } : {}),
      ...(input.collaborationMode ? { collaborationMode: input.collaborationMode as 'default' | 'plan' } : {}),
      ...(input.reviewTarget !== undefined ? { reviewTarget: input.reviewTarget as NonNullable<SendMessageRequest['codex']>['reviewTarget'] } : {}),
      ...(input.permissionPreset ? { permissionPreset: input.permissionPreset } : {}),
      ...(input.serviceTier !== undefined ? { serviceTier: input.serviceTier } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
    } } : {}),
  }
}

export function respondDesktopPermission(session: Session, input: Parameters<SessionHostPort['respondPermission']>[0]): void {
  const handled = session.respondToPermission(input.interactionId, input.decision === 'allow' || input.decision === 'allow_always', input.decision === 'allow_always', input.reason, input.selectedSuggestions, input.cancel ? 'cancel' : undefined, input.formAnswers)
  if (!handled) throw Object.assign(new Error('no matching pending permission'), { code: 'failed_precondition' })
}

export function respondDesktopQuestion(session: Session, input: Parameters<SessionHostPort['respondQuestion']>[0]): void {
  if (input.dismiss) session.dismissQuestion(input.interactionId)
  else session.respondToQuestion(input.interactionId, (input.answers ?? {}) as Record<string, string>, input.annotations)
}

export async function respondDesktopPlan(session: Session, input: Parameters<SessionHostPort['respondPlan']>[0]): Promise<void> {
  const feedback = typeof input.options?.feedback === 'string' ? input.options.feedback : undefined
  if (typeof input.options?.messageId === 'string') {
    if (session.snapshot.harnessId !== 'codex') throw Object.assign(new Error('No active Codex session'), { code: 'failed_precondition' })
    if (!input.options.messageId) throw Object.assign(new Error('messageId is required'), { code: 'invalid_argument' })
    await session.dispatchBackendCommand({ kind: 'codex.plan_approval', messageId: input.options.messageId, status: input.decision === 'approve' ? 'approved' : 'rejected', ...(feedback !== undefined ? { feedback } : {}) })
    return
  }
  session.respondToPlanApproval(input.interactionId, input.decision === 'approve', feedback)
}
