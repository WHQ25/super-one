const MEDIA_GENERATE_VIDEO_TOOL = 'mcp__superone__media_generate_video'
const MEDIA_VIDEO_STATUS_TOOL = 'mcp__superone__media_video_status'

export function isMediaGenerateVideoTool(toolName: string): boolean {
  return toolName === MEDIA_GENERATE_VIDEO_TOOL
}

export function isMediaVideoStatusTool(toolName: string): boolean {
  return toolName === MEDIA_VIDEO_STATUS_TOOL
}
