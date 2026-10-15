export const sessionContinuationEnglish = {
  'Handoff to New Session': 'Handoff to New Session',
  'This session is long and its prompt cache has expired, so the next message here re-reads the whole context.': 'This session is long and its prompt cache has expired, so the next message here re-reads the whole context.',
  'A fresh context: faster, cheaper replies.': 'A fresh context: faster, cheaper replies.',
  'The new session mentions this one, so the agent can still look up anything from it.': 'The new session mentions this one, so the agent can still look up anything from it.',
  'Collaboration carries over: parent, child and linked sessions reach the new session.': 'Collaboration carries over: parent, child and linked sessions reach the new session.',
}
export const sessionContinuationChinese: Record<keyof typeof sessionContinuationEnglish, string> = {
  'Handoff to New Session': '移交到新会话',
  'This session is long and its prompt cache has expired, so the next message here re-reads the whole context.': '这个会话较长，提示缓存已过期，在这里发送下一条消息会重新读取整段上下文。',
  'A fresh context: faster, cheaper replies.': '全新上下文：回复更快、更省。',
  'The new session mentions this one, so the agent can still look up anything from it.': '新会话会引用当前会话，agent 仍可随时查阅其中的内容。',
  'Collaboration carries over: parent, child and linked sessions reach the new session.': '协作关系保留：父会话、子会话和关联会话都会转到新会话。',
}
