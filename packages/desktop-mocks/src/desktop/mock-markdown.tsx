"use client"

import { CopyableMarkdown } from "./chat-md/CopyableMarkdown"

export function MockMarkdown({
  text,
  isStreaming,
}: {
  text: string
  isStreaming?: boolean
}) {
  return <CopyableMarkdown text={text} isStreaming={isStreaming ?? false} />
}
