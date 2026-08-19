/**
 * Ссылки сообщества NEXUS.
 *
 * Адреса собраны в одном месте намеренно: они встречаются в окне «О программе»,
 * в меню трея и в шаблонах постов для канала. Пока они были разбросаны по
 * разметке, любое переименование канала пришлось бы искать по всему проекту, а
 * забытая строка вела бы пользователей на несуществующий адрес.
 */

export interface CommunityLink {
  /** Ключ для интерфейса: по нему выбирается значок и порядок кнопок. */
  id: 'channel' | 'chat' | 'site';
  /** Подпись кнопки. Переводится словарём интерфейса. */
  title: string;
  /** Короткое пояснение — зачем сюда идти. */
  description: string;
  url: string;
}

/**
 * Адрес канала указан один раз. Если канал переедет, меняется только эта
 * строка — интерфейс, трей и генератор постов возьмут новое значение сами.
 */
export const TELEGRAM_CHANNEL = 'https://t.me/nexus_flex';

export const COMMUNITY_LINKS: CommunityLink[] = [
  {
    id: 'channel',
    title: 'Телеграм-канал',
    description: 'Новости, обновления и разбор проблем.',
    url: TELEGRAM_CHANNEL,
  },
];

/**
 * Разрешён ли переход по ссылке.
 *
 * `shell.openExternal` открывает всё что угодно, включая `file:` и локальные
 * программы. Через окно приложения адрес прийти не должен, но проверка стоит
 * дёшево, а последствия ошибки — запуск постороннего файла с правами
 * администратора: NEXUS всегда работает с повышенными правами.
 */
export function isAllowedCommunityUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return COMMUNITY_LINKS.some((link) => link.url === value);
}
