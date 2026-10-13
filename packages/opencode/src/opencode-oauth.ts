import { randomUUID } from 'node:crypto'
import type { FormAnswer, FormFields, IntegrationOauthConnectInput } from '@opencode/client'
import type { OpenCodeV2Client } from './opencode-v2-client'
import type { OpenCodeRuntimeEvent } from './runtime-types'
import type { OpenCodeV2Form, OpenCodeV2Event } from './opencode-v2-types'
import { openCodeV2FormAnswer } from './opencode-v2-event-map'

type OAuthClient = Pick<
  OpenCodeV2Client,
  'nativeMcpServers' | 'integration' | 'startOAuth' | 'oauthStatus' | 'completeOAuth' | 'cancelOAuth' | 'connectMcp'
>
type PendingForm = { form: OpenCodeV2Form; owner: AbortController; reply(answer: FormAnswer): void; cancel(): void }
export interface OAuthBrowserContext {
  mode: 'auto' | 'code'
  signal: AbortSignal
  instructions?: string
}

/** Native attempts own credentials; host forms only collect method inputs/codes. */
export class OpenCodeOAuth {
  private readonly forms = new Map<string, PendingForm>()
  private readonly active = new Map<string, { controller: AbortController; task: Promise<void> }>()

  constructor(
    private readonly deps: {
      client: OAuthClient
      sessionId: string
      signal: AbortSignal
      onEvent(event: OpenCodeRuntimeEvent): void
      openUrl(url: string, context: OAuthBrowserContext): Promise<void>
      assertControl?: () => void
      pollMs?: number
      timeoutMs?: number
    },
  ) {}

  get busy() {
    return this.active.size > 0
  }
  get snapshotEvents(): OpenCodeRuntimeEvent[] {
    return [...this.forms.values()].map(({ form }) => ({
      type: 'v2',
      event: { id: `snapshot-${form.id}`, type: 'form.created', data: { form } },
    }))
  }

  authenticate(name: string, assertControl = this.deps.assertControl): Promise<void> {
    assertControl?.()
    const existing = this.active.get(name)
    if (existing) return existing.task
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, this.deps.signal])
    const timer = setTimeout(
      () => controller.abort(new Error('OpenCode sign-in timed out')),
      this.deps.timeoutMs ?? 5 * 60_000,
    )
    const task = this.run(name, signal, controller, assertControl).finally(() => {
      clearTimeout(timer)
      this.active.delete(name)
    })
    this.active.set(name, { controller, task })
    return task
  }

  reply(id: string, answers: string[][]): boolean {
    const pending = this.forms.get(id)
    if (!pending) return false
    pending.reply(openCodeV2FormAnswer(pending.form, answers))
    return true
  }
  reject(id: string): boolean {
    const pending = this.forms.get(id)
    if (!pending) return false
    pending.cancel()
    return true
  }
  async close(): Promise<void> {
    const flows = [...this.active.values()]
    for (const flow of flows) flow.controller.abort(new Error('OpenCode sign-in cancelled'))
    await Promise.allSettled(flows.map((flow) => flow.task))
  }

  private emit(type: OpenCodeV2Event['type'], data: Record<string, unknown>) {
    this.deps.onEvent({
      type: 'v2',
      event: {
        id: `oauth-${randomUUID()}`,
        type,
        data: { sessionID: this.deps.sessionId, ...data },
      } as OpenCodeV2Event,
    })
  }

  private ask(
    title: string,
    fields: FormFields,
    signal: AbortSignal,
    controller: AbortController,
  ): Promise<FormAnswer> {
    signal.throwIfAborted()
    if (fields.some((field) => field.type === 'external'))
      throw new Error('This OpenCode sign-in method requires an unsupported external form field')
    const form: OpenCodeV2Form = { id: `superone-oauth-${randomUUID()}`, sessionID: this.deps.sessionId, title, fields }
    return new Promise((resolve, reject) => {
      const finish = (answer?: FormAnswer) => {
        this.forms.delete(form.id)
        signal.removeEventListener('abort', aborted)
        this.emit(answer ? 'form.replied' : 'form.cancelled', { id: form.id, ...(answer ? { answer } : {}) })
        if (answer) resolve(answer)
        else reject(signal.reason ?? new Error('OpenCode sign-in cancelled'))
      }
      const aborted = () => finish()
      this.forms.set(form.id, {
        form,
        owner: controller,
        reply: (answer) => finish(answer),
        cancel: () => controller.abort(new Error('OpenCode sign-in cancelled')),
      })
      signal.addEventListener('abort', aborted, { once: true })
      this.emit('form.created', { form })
    })
  }

  private async run(name: string, signal: AbortSignal, controller: AbortController, assertControl?: () => void): Promise<void> {
    const server = (await this.deps.client.nativeMcpServers(signal)).find((item) => item.name === name)
    signal.throwIfAborted()
    if (!server?.integrationID) throw new Error(`MCP server ${name} does not offer native sign-in`)
    const id = server.integrationID
    const integration = await this.deps.client.integration(id, signal)
    const methods = integration.methods.filter((method) => method.type === 'oauth')
    if (!methods.length) throw new Error(`MCP server ${name} does not offer OAuth`)
    const selected =
      methods.length === 1
        ? methods[0].id
        : (
            await this.ask(
              `Sign in to ${integration.name}`,
              [
                {
                  key: 'method',
                  type: 'string',
                  title: 'Sign-in method',
                  required: true,
                  options: methods.map((method) => ({ value: method.id, label: method.label })),
                },
              ],
              signal,
              controller,
            )
          ).method
    const method = methods.find((item) => item.id === selected)
    if (!method) throw new Error('Select an available OpenCode sign-in method')
    const answer = method.form
      ? await this.ask(`Sign in to ${integration.name}`, method.form, signal, controller)
      : undefined
    const guard: [(() => void)?] = assertControl ? [assertControl] : []
    const attempt = await this.deps.client.startOAuth(
      id,
      method.id,
      answer as IntegrationOauthConnectInput['answer'],
      signal,
      ...guard,
    )
    const expiry = setTimeout(
      () => controller.abort(new Error('OpenCode sign-in expired; start a new sign-in attempt')),
      Math.max(0, attempt.time.expires - Date.now()),
    )
    let complete = false
    let notice: Promise<FormAnswer> | undefined
    try {
      const url = new URL(attempt.url)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new Error('OpenCode returned an unsupported sign-in URL')
      assertControl?.()
      await this.deps.openUrl(url.href, { mode: attempt.mode, signal, instructions: attempt.instructions })
      signal.throwIfAborted()
      if (attempt.mode === 'code') {
        const value = await this.ask(
          `Sign in to ${integration.name}`,
          [
            {
              key: 'code',
              type: 'string',
              title: 'Authorization code',
              required: true,
              description: attempt.instructions,
              minLength: 1,
            },
          ],
          signal,
          controller,
        )
        if (typeof value.code !== 'string' || !value.code.trim()) throw new Error('Enter the authorization code')
        await this.deps.client.completeOAuth(id, attempt.attemptID, value.code.trim(), signal, ...guard)
      } else {
        notice = this.ask(
          `Sign in to ${integration.name}`,
          [
            {
              key: 'wait',
              type: 'string',
              title: 'Finish sign-in in your browser',
              description: attempt.instructions,
              options: [{ value: 'waiting', label: 'Continue waiting' }],
            },
          ],
          signal,
          controller,
        )
        // The callback completes automatically; the form offers a dismiss/cancel
        // path while it waits and never controls credential acceptance.
        void notice.catch(() => undefined)
      }
      while (Date.now() < attempt.time.expires) {
        signal.throwIfAborted()
        assertControl?.()
        const status = await this.deps.client.oauthStatus(id, attempt.attemptID, signal)
        if (status.status === 'complete') {
          complete = true
          await this.deps.client.connectMcp(name, signal, ...guard)
          return
        }
        if (status.status === 'failed') throw new Error(status.message)
        if (status.status === 'expired') break
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timer)
            reject(signal.reason)
          }
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
          }, this.deps.pollMs ?? 1000)
          signal.addEventListener('abort', onAbort, { once: true })
        })
      }
      throw new Error('OpenCode sign-in expired; start a new sign-in attempt')
    } finally {
      clearTimeout(expiry)
      if (!complete && !signal.aborted) controller.abort(new Error('OpenCode sign-in did not complete'))
      // Resolve host waiting forms without aborting a successful native attempt.
      for (const pending of [...this.forms.values()]) {
        if (pending.owner === controller) pending.reply({})
      }
      if (!complete) await this.deps.client.cancelOAuth(id, attempt.attemptID).catch(() => undefined)
    }
  }
}
