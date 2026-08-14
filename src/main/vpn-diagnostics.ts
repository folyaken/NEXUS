import type { VpnDiagnosticCheck, VpnDiagnosticEvent, VpnDiagnostics } from './types';

const MAX_DIAGNOSTIC_TEXT = 500;
const SECRET_SCHEME = /\b(vless|vmess|trojan|ss|ssr|hy2|hysteria2):\/\/[^\s"'<>]+/gi;
const WEB_URL = /https?:\/\/[^\s"'<>]+/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const LABELED_SECRET = /\b(token|access[_-]?token|password|passwd|pass|uuid|secret|authorization|public[_-]?key|private[_-]?key|short[_-]?id|obfs)["']?\s*([=:]\s*)('[^']*'|"[^"]*"|[^\s,;]+)/gi;

function maskWebUrl(raw: string): string {
  const suffix = /[),.;!?]$/.test(raw) ? raw.slice(-1) : '';
  const candidate = suffix ? raw.slice(0, -1) : raw;
  try {
    const parsed = new URL(candidate);
    return `${parsed.protocol}//${parsed.host}/…${suffix}`;
  } catch {
    return `[URL скрыт]${suffix}`;
  }
}

/**
 * Removes connection credentials and local user names from text before it is
 * exposed to the renderer or included in a support report.
 */
export function sanitizeDiagnosticText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(SECRET_SCHEME, (_match, scheme: string) => `${scheme.toLowerCase()}://[скрыто]`)
    .replace(WEB_URL, maskWebUrl)
    .replace(UUID, '[UUID скрыт]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [скрыто]')
    .replace(LABELED_SECRET, (_match, label: string, separator: string) => `${label}${separator}[скрыто]`)
    .replace(/([A-Z]:\\Users\\)[^\\\s]+/gi, '$1[пользователь]')
    .slice(0, MAX_DIAGNOSTIC_TEXT);
}

export type VpnDiagnosticsData = Omit<VpnDiagnostics, 'report' | 'profileName' | 'endpoint' | 'checks' | 'events'> & {
  profileName: string | null;
  endpoint: string | null;
  checks: VpnDiagnosticCheck[];
  events: VpnDiagnosticEvent[];
};

function safeCheck(check: VpnDiagnosticCheck): VpnDiagnosticCheck {
  return {
    id: check.id.replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'check',
    title: sanitizeDiagnosticText(check.title),
    tone: check.tone,
    summary: sanitizeDiagnosticText(check.summary),
    detail: check.detail ? sanitizeDiagnosticText(check.detail) : null,
  };
}

function safeEvent(event: VpnDiagnosticEvent): VpnDiagnosticEvent {
  return {
    timestamp: Number.isFinite(Date.parse(event.timestamp)) ? new Date(event.timestamp).toISOString() : new Date(0).toISOString(),
    level: event.level,
    message: sanitizeDiagnosticText(event.message),
  };
}

function buildReport(data: Omit<VpnDiagnostics, 'report'>): string {
  const status = ({ connected: 'подключено', connecting: 'подключение', disconnecting: 'отключение', disconnected: 'отключено', error: 'ошибка' })[data.runtimeStatus];
  const lines = [
    'NEXUS · безопасная диагностика Jey2Ray',
    `Время: ${data.generatedAt}`,
    `Итог: ${data.headline}`,
    `Состояние: ${status}`,
    `Режим: ${data.mode.toUpperCase()}`,
    `Ядро: ${data.engine}`,
    `Профиль: ${data.profileName ?? 'не выбран'}`,
    `Протокол: ${data.protocol?.toUpperCase() ?? '—'}`,
    `Сервер: ${data.endpoint ?? '—'}`,
    `Локально: SOCKS ${data.localSocks}; HTTP ${data.localHttp}`,
    '',
    'Проверки:',
    ...data.checks.map((check) => `- [${check.tone.toUpperCase()}] ${check.title}: ${check.summary}${check.detail ? ` — ${check.detail}` : ''}`),
  ];

  if (data.events.length) {
    lines.push('', 'Последние события:');
    for (const event of data.events) lines.push(`- ${event.timestamp} [${event.level.toUpperCase()}] ${event.message}`);
  }
  lines.push('', 'Секреты подключения, UUID, пароли и URL подписок в отчёт не включаются.');
  return lines.join('\n');
}

/** Final security boundary for every diagnostic snapshot sent over IPC. */
export function createVpnDiagnostics(input: VpnDiagnosticsData): VpnDiagnostics {
  const safe: Omit<VpnDiagnostics, 'report'> = {
    ...input,
    profileName: input.profileName ? sanitizeDiagnosticText(input.profileName) : null,
    endpoint: input.endpoint ? sanitizeDiagnosticText(input.endpoint) : null,
    checks: input.checks.map(safeCheck),
    events: input.events.slice(0, 8).map(safeEvent),
  };
  return { ...safe, report: buildReport(safe) };
}
