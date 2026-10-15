export const sessionContinuationEnglish = {
  'Handoff to New Session': 'Handoff to New Session',
  'This session is long and its cache has expired. Continuing it here uploads the whole context again: slower, more expensive, and heavy on your subscription usage. Handing off to a new session is recommended.': 'This session is long and its cache has expired. Continuing it here uploads the whole context again: slower, more expensive, and heavy on your subscription usage. Handing off to a new session is recommended.',
  'The new session mentions this one automatically, so its context is kept and the agent reads it as needed.': 'The new session mentions this one automatically, so its context is kept and the agent reads it as needed.',
  'Keeps working with every collaborator of this session.': 'Keeps working with every collaborator of this session.',
}
export const sessionContinuationChinese: Record<keyof typeof sessionContinuationEnglish, string> = {
  'Handoff to New Session': '移交到新会话',
  'This session is long and its cache has expired. Continuing it here uploads the whole context again: slower, more expensive, and heavy on your subscription usage. Handing off to a new session is recommended.': '该会话较长且缓存已过期，在同一会话继续对话会重新上传整段上下文，速度慢，费用更高，会消耗大量订阅用量。建议移交到新会话。',
  'The new session mentions this one automatically, so its context is kept and the agent reads it as needed.': '新会话自动引用当前会话，上下文保留，agent 可按需读取。',
  'Keeps working with every collaborator of this session.': '可以和原会话的所有协作者正常协作。',
}
