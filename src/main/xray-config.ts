import { xrayProcessSelectors } from './split-tunnel';
import type { VpnAppRoutingMode, VpnLinkParams, VpnSplitApp } from './types';

function vlessFlow(params: VpnLinkParams): string {
  const network = (params.network || 'tcp').toLowerCase();
  if (network === 'grpc' || network === 'ws' || network === 'h2') return '';
  if (params.flow) return params.flow;
  if ((params.security || '').toLowerCase() === 'reality') return 'xtls-rprx-vision';
  return '';
}

function streamSettings(params: VpnLinkParams): Record<string, unknown> {
  const network = (params.network || 'tcp').toLowerCase();
  const security = (params.security || 'none').toLowerCase();
  const stream: Record<string, unknown> = { network };

  if (network === 'ws') {
    stream.wsSettings = {
      path: params.path || '/',
      headers: params.host ? { Host: params.host } : undefined,
    };
  } else if (network === 'grpc') {
    stream.grpcSettings = { serviceName: params.serviceName || params.path || '' };
  } else if (network === 'h2' || network === 'http') {
    stream.httpSettings = { path: params.path || '/', host: params.host ? [params.host] : undefined };
  } else if (params.headerType === 'http') {
    stream.tcpSettings = { header: { type: 'http', request: { headers: { Host: [params.host || params.sni || params.address] } } } };
  }

  if (security === 'reality') {
    stream.security = 'reality';
    stream.realitySettings = {
      serverName: params.sni || params.host || params.address,
      fingerprint: params.fingerprint || 'chrome',
      publicKey: params.publicKey,
      shortId: params.shortId || '',
      spiderX: params.spiderX || '/',
    };
  } else if (security === 'tls' || security === 'xtls') {
    stream.security = 'tls';
    stream.tlsSettings = {
      serverName: params.sni || params.host || params.address,
      allowInsecure: Boolean(params.allowInsecure),
      fingerprint: params.fingerprint || undefined,
      alpn: params.alpn ? params.alpn.split(',') : undefined,
    };
  } else {
    stream.security = 'none';
  }

  return stream;
}

function outbound(params: VpnLinkParams): Record<string, unknown> {
  if (params.protocol === 'vless') {
    return {
      protocol: 'vless',
      settings: {
        vnext: [{
          address: params.address,
          port: params.port,
          users: [{
            id: params.uuid,
            encryption: params.encryption || 'none',
            flow: vlessFlow(params),
          }],
        }],
      },
      streamSettings: streamSettings(params),
    };
  }

  if (params.protocol === 'vmess') {
    return {
      protocol: 'vmess',
      settings: {
        vnext: [{
          address: params.address,
          port: params.port,
          users: [{
            id: params.uuid,
            alterId: params.alterId ?? 0,
            security: params.encryption || 'auto',
          }],
        }],
      },
      streamSettings: streamSettings(params),
    };
  }

  if (params.protocol === 'trojan') {
    return {
      protocol: 'trojan',
      settings: {
        servers: [{
          address: params.address,
          port: params.port,
          password: params.password,
        }],
      },
      streamSettings: streamSettings(params),
    };
  }

  if (params.protocol === 'hysteria2') {
    return {
      protocol: 'hysteria2',
      settings: {
        servers: [{
          address: params.address,
          port: params.port,
          password: params.password,
        }],
      },
      streamSettings: {
        network: 'hysteria2',
        security: 'tls',
        tlsSettings: {
          serverName: params.sni || params.address,
          allowInsecure: Boolean(params.allowInsecure),
        },
      },
    };
  }

  return {
    protocol: 'shadowsocks',
    settings: {
      servers: [{
        address: params.address,
        port: params.port,
        method: params.method || 'aes-256-gcm',
        password: params.password,
      }],
    },
    streamSettings: { network: 'tcp', security: 'none' },
  };
}

export function buildXrayConfig(
  params: VpnLinkParams,
  inboundPort: number,
  mode: 'proxy' | 'tun' = 'proxy',
  splitApps: VpnSplitApp[] = [],
  appRouting: VpnAppRoutingMode = 'include',
): Record<string, unknown> {
  const inbounds: Record<string, unknown>[] = [{
    tag: 'socks-in',
    port: inboundPort,
    listen: '127.0.0.1',
    protocol: 'socks',
    settings: { auth: 'noauth', udp: true },
    sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
  }, {
    tag: 'http-in',
    port: inboundPort + 1,
    listen: '127.0.0.1',
    protocol: 'http',
    settings: { allowTransparent: false },
  }];
  if (mode === 'tun') {
    inbounds.push({
      tag: 'tun-in',
      protocol: 'tun',
      settings: {
        name: 'nexus',
        desc: 'NEXUS',
        mtu: 1500,
        gateway: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
        autoSystemRoutingTable: ['0.0.0.0/0', '::/0'],
        autoOutboundsInterface: 'auto',
      },
      sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] },
    });
  }

  const process = mode === 'tun' && appRouting !== 'system' ? xrayProcessSelectors(splitApps) : [];
  const selectedOutbound = appRouting === 'exclude' ? 'direct' : 'proxy';
  const fallbackOutbound = appRouting === 'exclude' ? 'proxy' : 'direct';
  const routing = process.length ? {
    domainStrategy: 'AsIs',
    rules: [
      { type: 'field', process: ['self/', 'xray/'], outboundTag: 'direct' },
      { type: 'field', inboundTag: ['tun-in'], process, outboundTag: selectedOutbound },
      { type: 'field', inboundTag: ['tun-in'], outboundTag: fallbackOutbound },
    ],
  } : undefined;

  return {
    log: { loglevel: 'warning' },
    inbounds,
    outbounds: [
      { tag: 'proxy', ...outbound(params) },
      { tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'block', protocol: 'blackhole', settings: {} },
    ],
    ...(routing ? { routing } : {}),
  };
}
