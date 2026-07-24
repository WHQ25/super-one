import { trace } from "../agent/event-trace";

type JsonRecord = Record<string, unknown>;
type TraceContext = { req?: { id?: string } };

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

export function normalizeAdaptiveThinkingRequest(request: unknown): void {
  const thinking = asRecord(asRecord(request)?.thinking);
  if (thinking?.type === "adaptive") thinking.type = "enabled";
}

function supportsReasoningEffort(model: unknown): boolean {
  if (typeof model !== "string") return false;
  return /^o\d/i.test(model) || /^gpt-[5-9]/i.test(model);
}

export function normalizeOpenAiReasoningRequest(request: JsonRecord): void {
  const reasoning = asRecord(request.reasoning);
  if (!reasoning || reasoning.enabled !== true || !supportsReasoningEffort(request.model))
    return;

  if (typeof reasoning.effort === "string")
    request.reasoning_effort = reasoning.effort;
  delete request.reasoning;
  delete request.thinking;
  delete request.enable_thinking;
}

function reasoningFields(value: unknown): string[] {
  const choices = asRecord(value)?.choices;
  const choice = Array.isArray(choices) ? asRecord(choices[0]) : undefined;
  const delta = asRecord(choice?.delta);
  const message = asRecord(choice?.message);
  const fields: string[] = [];

  for (const [prefix, source] of [
    ["delta", delta],
    ["message", message],
  ] as const) {
    if (!source) continue;
    if (typeof source.reasoning_content === "string")
      fields.push(`${prefix}.reasoning_content`);
    if (typeof source.reasoning === "string" || asRecord(source.reasoning))
      fields.push(`${prefix}.reasoning`);
    if (Array.isArray(source.reasoning_details))
      fields.push(`${prefix}.reasoning_details`);
    if (
      typeof source.content === "string" &&
      source.content.includes("<think>")
    )
      fields.push(`${prefix}.content:<think>`);
  }

  return fields;
}

function responseKeys(value: unknown): string[] {
  const choices = asRecord(value)?.choices;
  const choice = Array.isArray(choices) ? asRecord(choices[0]) : undefined;
  const keys: string[] = [];
  for (const [prefix, source] of [
    ["delta", asRecord(choice?.delta)],
    ["message", asRecord(choice?.message)],
  ] as const) {
    if (source)
      keys.push(`${prefix}=[${Object.keys(source).sort().join(",")}]`);
  }
  return keys;
}

function log(message: string): void {
  process.stderr.write(`[llm-proxy] ${message}\n`);
}

function traceTag(context?: TraceContext): string | undefined {
  return context?.req?.id;
}

async function traceResponse(
  response: Response,
  source: string,
  context?: TraceContext,
): Promise<Response> {
  const contentType = response.headers.get("Content-Type") ?? "";
  const tag = traceTag(context);
  if (contentType.includes("application/json")) {
    const body = await response.json();
    trace(source, "json", body, tag);
    return new Response(JSON.stringify(body), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  if (!contentType.includes("text/event-stream") || !response.body)
    return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = response.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data:")) {
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") trace(source, "sse_done", null, tag);
              else {
                try {
                  trace(source, "sse", JSON.parse(payload), tag);
                } catch {
                  trace(source, "sse_unparsed", { payload }, tag);
                }
              }
            }
            controller.enqueue(encoder.encode(`${line}\n`));
          }
        }
        if (buffer) controller.enqueue(encoder.encode(buffer));
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export class OpenAiReasoningDiagnostic {
  name = "superone-reasoning-diagnostic";

  async transformRequestIn(
    request: JsonRecord,
    _provider?: unknown,
    context?: TraceContext,
  ): Promise<JsonRecord> {
    normalizeOpenAiReasoningRequest(request);
    trace("llm-proxy.in", "openai_request", request, traceTag(context));
    log(
      `OpenAI reasoning request stream=${String(request.stream === true)} requested=${String(asRecord(request.reasoning) !== undefined || typeof request.reasoning_effort === "string")}`,
    );
    return request;
  }

  async transformResponseOut(
    response: Response,
    context?: TraceContext,
  ): Promise<Response> {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await response.json();
      trace("llm-proxy.upstream", "json", body, traceTag(context));
      log(
        `OpenAI reasoning response fields=${reasoningFields(body).join(",") || "none"} keys=${responseKeys(body).join(";") || "none"}`,
      );
      return new Response(JSON.stringify(body), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    if (!contentType.includes("text/event-stream") || !response.body)
      return response;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const fields = new Set<string>();
    const keys = new Set<string>();
    let buffer = "";
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = response.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.startsWith("data:")) {
                try {
                  const data = JSON.parse(line.slice(5).trim());
                  trace("llm-proxy.upstream", "sse", data, traceTag(context));
                  for (const field of reasoningFields(data)) fields.add(field);
                  for (const key of responseKeys(data)) keys.add(key);
                } catch {}
              }
              controller.enqueue(encoder.encode(`${line}\n`));
            }
          }
          if (buffer) controller.enqueue(encoder.encode(buffer));
          log(
            `OpenAI reasoning stream fields=${[...fields].join(",") || "none"} keys=${[...keys].join(";") || "none"}`,
          );
          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
}

export class OpenAiNormalizedTrace {
  name = "superone-normalized-trace";

  async transformResponseOut(
    response: Response,
    context?: TraceContext,
  ): Promise<Response> {
    return traceResponse(response, "llm-proxy.out", context);
  }
}
