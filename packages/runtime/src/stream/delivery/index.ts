/**
 * Per-connection delivery: the stages a delivery policy composes (tier cost
 * controls, client surface adapters), summary projection with on-demand
 * detail, and the local tier's Codex patches.
 */
export { ConnectionDelivery, batchingFor } from './connection-delivery'
export { EventProfile, type ProfilePorts } from './profile'
export { DetailViews, detailMessageId, projectProgressiveEvent, projectProgressiveMessage } from './projection'
export { createLocalDelivery, type LocalDelivery } from './local-delivery'
export { configureRemoteContent, type RemoteContentPorts } from './remote-content'
