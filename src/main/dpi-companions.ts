/**
 * Сопутствующие домены сервисов.
 *
 * Важно понимать разницу между двумя случаями:
 *
 * 1. **Поддомены** (`i.instagram.com`, `scontent.instagram.com`) Zapret
 *    подхватывает сам: в документации ядра сказано «subdomains auto apply».
 *    Достаточно одной записи `instagram.com` — перечислять их не нужно и вредно,
 *    список только раздувается.
 *
 * 2. **Отдельные домены** того же сервиса (`cdninstagram.com`, `fbcdn.net`)
 *    поддоменами не являются. Автоматика ядра их не покрывает, и без них сайт
 *    открывается «наполовину»: страница грузится, а картинки и видео нет.
 *
 * Здесь описан только второй случай. Группы двусторонние: добавление любого
 * домена группы подключает остальные, поэтому пользователю достаточно вписать
 * привычный адрес.
 */

/** Группы доменов, обслуживающих один и тот же сервис. */
const DOMAIN_GROUPS: readonly (readonly string[])[] = [
  // Meta
  ['instagram.com', 'cdninstagram.com', 'fbcdn.net'],
  ['facebook.com', 'fbcdn.net', 'facebook.net', 'fbsbx.com', 'fb.com'],
  ['whatsapp.com', 'whatsapp.net', 'wa.me'],
  // X / Twitter
  ['twitter.com', 'x.com', 'twimg.com', 't.co'],
  // Google / YouTube
  ['youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com', 'ggpht.com', 'youtubekids.com'],
  // Музыка и видео
  ['soundcloud.com', 'sndcdn.com'],
  ['spotify.com', 'scdn.co', 'spotifycdn.com'],
  ['netflix.com', 'nflxvideo.net', 'nflximg.net', 'nflxso.net', 'nflxext.com'],
  ['twitch.tv', 'ttvnw.net', 'jtvnw.net', 'twitchcdn.net'],
  ['vimeo.com', 'vimeocdn.com'],
  // Соцсети и медиа
  ['discord.com', 'discordapp.com', 'discordapp.net', 'discord.gg', 'discord.media'],
  ['telegram.org', 't.me', 'telesco.pe', 'telegram.me', 'cdn-telegram.org'],
  ['reddit.com', 'redd.it', 'redditstatic.com', 'redditmedia.com'],
  ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com', 'ibytedtos.com'],
  ['linkedin.com', 'licdn.com'],
  ['pinterest.com', 'pinimg.com'],
  ['tumblr.com', 'tumblr.co'],
  // Нейросети
  ['openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com'],
  ['claude.ai', 'anthropic.com'],
  ['gemini.google.com', 'bard.google.com'],
  ['perplexity.ai', 'pplx.ai'],
  // Разработка
  ['github.com', 'githubusercontent.com', 'githubassets.com', 'github.io'],
  ['gitlab.com', 'gitlab-static.net'],
  ['stackoverflow.com', 'sstatic.net'],
  ['docker.com', 'docker.io', 'dockerhub.com'],
  ['npmjs.com', 'npmjs.org'],
  // Прочее
  ['rutracker.org', 'rutrk.org', 'rutracker.net'],
  ['archive.org', 'archive.is'],
  ['medium.com', 'medium.co'],
  ['duckduckgo.com', 'duck.com'],
  ['protonmail.com', 'proton.me', 'protonvpn.com'],
  ['signal.org', 'signal.art'],
  ['patreon.com', 'patreonusercontent.com'],
  ['deviantart.com', 'wixmp.com'],
  ['imgur.com', 'imgur.io'],
  ['coub.com', 'coub-cdn.com'],
];

/** Домен -> все домены его группы. Строится один раз при загрузке модуля. */
const COMPANIONS = new Map<string, readonly string[]>();
for (const group of DOMAIN_GROUPS) {
  for (const domain of group) {
    // Домен может встречаться в нескольких группах (например, fbcdn.net
    // обслуживает и Instagram, и Facebook) — объединяем их.
    const merged = new Set(COMPANIONS.get(domain) ?? []);
    for (const item of group) merged.add(item);
    COMPANIONS.set(domain, [...merged]);
  }
}

/**
 * Домены, которые нужно записать в список Zapret для указанного адреса.
 *
 * Сам домен идёт первым, затем сопутствующие. Поддомены не добавляются: ядро
 * покрывает их автоматически.
 */
export function companionDomains(host: string): string[] {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return [];

  const direct = COMPANIONS.get(normalized);
  if (direct) return [normalized, ...direct.filter((item) => item !== normalized)];

  // Поддомен известного сервиса: `music.youtube.com` должен подтянуть ту же
  // группу, что и `youtube.com`.
  for (const [domain, group] of COMPANIONS) {
    if (normalized.endsWith(`.${domain}`)) {
      return [normalized, ...group.filter((item) => item !== normalized)];
    }
  }

  return [normalized];
}

/** Полный список доменов для записи в файл Zapret, без дубликатов. */
export function expandDpiHosts(hosts: readonly string[]): string[] {
  const expanded: string[] = [];
  const seen = new Set<string>();
  for (const host of hosts) {
    for (const domain of companionDomains(host)) {
      if (seen.has(domain)) continue;
      seen.add(domain);
      expanded.push(domain);
    }
  }
  return expanded;
}

/** Сколько дополнительных доменов подключится вместе с указанным. */
export function companionCount(host: string): number {
  return Math.max(0, companionDomains(host).length - 1);
}
