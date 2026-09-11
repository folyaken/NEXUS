import { createHash } from 'node:crypto';
import type { VpnProfile, VpnProtocol } from './types';

type ProfileIdentityInput = Pick<VpnProfile, 'protocol' | 'server' | 'port' | 'params'>;

function exactText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function trimmedText(value: unknown): string {
  return exactText(value).trim();
}

function lower(value: unknown): string {
  return trimmedText(value).toLowerCase();
}

function host(value: unknown): string {
  const raw = exactText(value);
  const trimmed = raw.trim();
  // Preserve unusual whitespace conservatively: the config builder would preserve it too.
  if (raw !== trimmed) return raw;
  return trimmed.toLowerCase().replace(/\.$/, '');
}

function profileProtocol(profile: ProfileIdentityInput): VpnProtocol {
  return profile.params.protocol || profile.protocol;
}

function streamIdentity(profile: ProfileIdentityInput): Record<string, unknown> {
  const params = profile.params;
  const protocol = profileProtocol(profile);
  const network = lower(params.network) || 'tcp';
  const rawSecurity = lower(params.security) || 'none';
  // The Xray builder emits TLS settings for both spellings.
  const security = rawSecurity === 'xtls' ? 'tls' : rawSecurity;
  let transport: Record<string, unknown> = {};

  if (network === 'ws') {
    transport = { path: exactText(params.path) || '/', host: host(params.host) };
  } else if (network === 'grpc') {
    transport = { serviceName: exactText(params.serviceName) || exactText(params.path) };
  } else if (network === 'h2' || network === 'http') {
    transport = { path: exactText(params.path) || '/', host: host(params.host) };
  } else if (params.headerType === 'http') {
    transport = { headerType: 'http', host: host(params.host || params.sni || params.address) };
  }

  let securitySettings: Record<string, unknown> = {};
  if (security === 'reality') {
    securitySettings = {
      serverName: host(params.sni || params.host || params.address),
      fingerprint: exactText(params.fingerprint) || 'chrome',
      publicKey: exactText(params.publicKey),
      shortId: exactText(params.shortId),
      spiderX: exactText(params.spiderX) || '/',
    };
  } else if (security === 'tls') {
    securitySettings = {
      serverName: host(params.sni || params.host || params.address),
      allowInsecure: Boolean(params.allowInsecure),
      fingerprint: exactText(params.fingerprint),
      alpn: exactText(params.alpn) ? exactText(params.alpn).split(',') : [],
    };
  }

  let flow = exactText(params.flow);
  if (protocol === 'vless' && ['grpc', 'ws', 'h2'].includes(network)) {
    flow = '';
  } else if (protocol === 'vless' && !flow && security === 'reality') {
    flow = 'xtls-rprx-vision';
  }

  return {
    network,
    transport,
    security,
    securitySettings,
    flow: protocol === 'vless' ? flow : '',
  };
}

/** A stable key for settings that actually change the generated VPN connection. */
export function profileConnectionKey(profile: ProfileIdentityInput): string {
  const params = profile.params;
  const protocol = profileProtocol(profile);
  const address = host(params.address);
  const port = Number(params.port);
  const base: Record<string, unknown> = {
    protocol,
    address,
    port,
    // Preserve malformed legacy mismatches instead of ever merging unlike records.
    profileProtocol: profile.protocol === protocol ? undefined : profile.protocol,
    profileServer: host(profile.server) === address ? undefined : host(profile.server),
    profilePort: Number(profile.port) === port ? undefined : Number(profile.port),
  };

  if (protocol === 'hysteria2') {
    return JSON.stringify({
      ...base,
      password: exactText(params.password || params.uuid),
      serverName: host(params.sni || params.address),
      allowInsecure: Boolean(params.allowInsecure),
      obfs: exactText(params.obfs),
    });
  }

  if (protocol === 'shadowsocks') {
    return JSON.stringify({
      ...base,
      method: exactText(params.method) || 'aes-256-gcm',
      password: exactText(params.password),
    });
  }

  const credentials = protocol === 'vless'
    ? { uuid: exactText(params.uuid), encryption: exactText(params.encryption) || 'none' }
    : protocol === 'vmess'
      ? { uuid: exactText(params.uuid), alterId: Number(params.alterId ?? 0), encryption: exactText(params.encryption) || 'auto' }
      : { password: exactText(params.password) };

  return JSON.stringify({ ...base, ...credentials, stream: streamIdentity(profile) });
}

export function profileSourceKey(subscriptionUrl?: string): string {
  if (!subscriptionUrl) return 'manual';
  try {
    const parsed = new URL(subscriptionUrl.trim());
    parsed.hash = '';
    return `subscription:${parsed.toString()}`;
  } catch {
    return `subscription:${subscriptionUrl.trim()}`;
  }
}

export function profileIdentityKey(profile: ProfileIdentityInput & Pick<Partial<VpnProfile>, 'subscriptionUrl'>): string {
  return `${profileSourceKey(profile.subscriptionUrl)}\n${profileConnectionKey(profile)}`;
}

export function stableProfileId(profile: ProfileIdentityInput, subscriptionUrl?: string): string {
  const source = profileSourceKey(subscriptionUrl);
  return createHash('sha256')
    .update(`nexus-vpn-profile-v1\0${source}\0${profileConnectionKey(profile)}`)
    .digest('hex')
    .slice(0, 20);
}
