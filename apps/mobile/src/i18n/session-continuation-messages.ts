export const sessionContinuationEnglish = {
  'Handoff to New Session': 'Handoff to New Session',
  'This session is long and its prompt cache has expired. The next message here sends the whole context again as input tokens: it costs more and uses a lot of your quota.': 'This session is long and its prompt cache has expired. The next message here sends the whole context again as input tokens: it costs more and uses a lot of your quota.',
  'A fresh context: faster, cheaper replies.': 'A fresh context: faster, cheaper replies.',
  'The new session mentions this one, so the agent can still look up anything from it.': 'The new session mentions this one, so the agent can still look up anything from it.',
  'Keeps working with every collaborator of this session.': 'Keeps working with every collaborator of this session.',
}
export const sessionContinuationChinese: Record<keyof typeof sessionContinuationEnglish, string> = {
  'Handoff to New Session': '移交到新会话',
  'This session is long and its prompt cache has expired. The next message here sends the whole context again as input tokens: it costs more and uses a lot of your quota.': '这个会话较长，提示缓存已过期。在这里发送下一条消息会把整段上下文重新作为 Input Token 发送，费用更高，也会消耗大量用量。',
  'A fresh context: faster, cheaper replies.': '全新上下文：回复更快、更省。',
  'The new session mentions this one, so the agent can still look up anything from it.': '新会话会引用当前会话，agent 仍可随时查阅其中的内容。',
  'Keeps working with every collaborator of this session.': '可以和原会话的所有协作者正常协作。',
}
