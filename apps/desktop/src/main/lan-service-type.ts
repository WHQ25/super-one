/** DNS-SD service types SuperOne publishes on the LAN (`lan-advertiser.ts`, `lan-browser.ts`). */

/** The phone link's host server. */
export const LAN_SERVICE_TYPE = 'superone'
/** The desktop node surface (`node-host/`), browsed by paired desktops. */
export const NODE_LAN_SERVICE_TYPE = 'superone-node'

export function lanServiceFqdn(serviceType: string): string {
  return `_${serviceType}._tcp`
}

export function lanServiceDomain(serviceType: string): string {
  return `${lanServiceFqdn(serviceType)}.local`
}
