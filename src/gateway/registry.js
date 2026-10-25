// The host plugin owns the gateway (it needs the session controller); the
// agent-scope chara_speak tool only needs to reach it. Both run in one DSH
// process, so they meet here, keyed by the chara's state dir.
const gateways = new Map()

export function registerGateway(key, gateway) {
  gateways.set(key, gateway)
  return () => {
    if (gateways.get(key) === gateway) gateways.delete(key)
  }
}

export function gatewayFor(key) {
  return gateways.get(key)
}
