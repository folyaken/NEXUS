import { inboundListenAddress } from './lan-share';
import { singboxDnsSection } from './dns-servers';
import { singboxProcessNames, singboxProcessPaths } from './split-tunnel';
import type { VpnAppRoutingMode, VpnLinkParams, VpnSplitApp } from './types';

export function buildSingboxConfig(
  params: VpnLinkParams,
  inboundPort: number,
  mode: 'proxy' | 'tun' = 'proxy',
  splitApps: VpnSplitApp[] = [],
  appRouting: VpnAppRoutingMode = 'include',
  allowLan = false,
  dnsServers: string[] = [],
): Record<string, unknown> {
  const listen = inboundListenAddress(allowLan);
  const inbounds: Record<string, unknown>[] = [
    { type: 'socks', tag: 'socks-in', listen, listen_port: inboundPort },
    { type: 'http', tag: 'http-in', listen, listen_port: inboundPort + 1 },
  ];
  if (mode === 'tun') {
    inbounds.push({
      type: 'tun',
      tag: 'tun-in',
      interface_name: 'nexus-tun',
      address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
      mtu: 1500,
      auto_route: true,
      strict_route: false,
      stack: 'mixed',
    });
  }

  const processNames = mode === 'tun' && appRouting !== 'system' ? singboxProcessNames(splitApps) : [];
  const processPaths = mode === 'tun' && appRouting !== 'system' ? singboxProcessPaths(splitApps) : [];
  const selectedOutbound = appRouting === 'exclude' ? 'direct' : 'proxy';
  const fallbackOutbound = appRouting === 'exclude' ? 'proxy' : 'direct';
  const splitRules: Record<string, unknown>[] = processNames.length ? [
    { inbound: ['tun-in'], process_name: processNames, action: 'route', outbound: selectedOutbound },
    { inbound: ['tun-in'], process_path: processPaths, action: 'route', outbound: selectedOutbound },
    { inbound: ['tun-in'], action: 'route', outbound: fallbackOutbound },
  ] : [];

  const dns = singboxDnsSection(dnsServers);

  return {
    log: { level: 'warn' },
    ...(dns ? { dns } : {}),
    inbounds,
    outbounds: [{
      type: 'hysteria2',
      tag: 'proxy',
      server: params.address,
      server_port: params.port,
      password: params.password || params.uuid || '',
      tls: {
        enabled: true,
        server_name: params.sni || params.address,
        insecure: Boolean(params.allowInsecure),
      },
      ...(params.obfs ? { obfs: { type: 'salamander', password: params.obfs } } : {}),
    }, {
      type: 'direct',
      tag: 'direct',
    }],
    route: {
      auto_detect_interface: true,
      rules: splitRules,
      final: 'proxy',
    },
  };
}
