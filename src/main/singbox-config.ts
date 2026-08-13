import type { VpnLinkParams } from './types';

export function buildSingboxConfig(params: VpnLinkParams, inboundPort: number): Record<string, unknown> {
  return {
    log: { level: 'warn' },
    inbounds: [
      { type: 'socks', tag: 'socks-in', listen: '127.0.0.1', listen_port: inboundPort },
      { type: 'http', tag: 'http-in', listen: '127.0.0.1', listen_port: inboundPort + 1 },
    ],
    outbounds: [{
      type: 'hysteria2',
      server: params.address,
      server_port: params.port,
      password: params.password || params.uuid || '',
      tls: {
        enabled: true,
        server_name: params.sni || params.address,
        insecure: Boolean(params.allowInsecure),
      },
      ...(params.obfs ? { obfs: { type: 'salamander', password: params.obfs } } : {}),
    }],
  };
}
