import { zoneRelativePath } from '../media-output-paths'
import { registerArtifact } from '../mcp/artifact-registry'

/**
 * Register a generated file with the artifact registry. The writers receive an
 * output directory, not a session — `mediaGenOutputDir(sessionId)` is the only
 * way that directory is built, so the session is read back off the layout
 * rather than threaded through every provider driver. A file outside the zone
 * (tests pointing at a temp dir) is simply not an artifact.
 */
export function registerZoneArtifact(filePath: string): void {
  const zone = zoneRelativePath(filePath)
  if (!zone) return
  registerArtifact(zone.sessionId, { path: filePath, producer: 'media-gen', final: true })
}
