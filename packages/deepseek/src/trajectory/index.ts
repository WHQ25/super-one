/** The trajectory projection: SuperOne's own view of a dsh session log. */

export { TrajectoryFold, RECORD_WINDOW } from './fold'
export { projectTrajectory } from './project'
export { diffHeaders, projectHeader } from './header'
export { PAYLOAD_MAX_CHARS } from './payload'
export type * from '@superone/shared/trajectory-types'
