import 'package:flutter/material.dart';

/// Лёгкая локализация без кодогенерации: словари RU/EN + delegate.
class AppLocalizations {
  AppLocalizations(this.locale);

  final Locale locale;

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  static AppLocalizations of(BuildContext context) =>
      Localizations.of<AppLocalizations>(context, AppLocalizations)!;

  String t(String key) => _lookup(key);

  String _lookup(String key) {
    final lang = locale.languageCode == 'ru' ? 'ru' : 'en';
    return _data[lang]![key] ?? _data['en']![key] ?? key;
  }

  static const Map<String, Map<String, String>> _data = {
    'ru': {
      // навигация
      'nav.dashboard': 'Панель',
      'nav.modules': 'Модули',
      'nav.vpn': 'Jey2Ray',
      'nav.settings': 'Настройки',
      // панель
      'dashboard.title': 'NEXUS',
      'dashboard.tagline': 'Центр управления сетью',
      'dashboard.pulse': 'ПУЛЬС СИСТЕМЫ',
      'dashboard.live': 'LIVE',
      'dashboard.running': 'активно',
      'dashboard.health': 'Здоровье',
      'dashboard.modules': 'Модулей',
      'dashboard.lastScan': 'Последний скан',
      'dashboard.quick': 'Быстрый доступ',
      'dashboard.all': 'Все модули',
      // модули
      'modules.title': 'Модули',
      'modules.dpi.name': 'Обход DPI',
      'modules.dpi.desc': 'YouTube, Discord, Instagram, X, TikTok',
      'modules.tg.name': 'TG WS Proxy',
      'modules.tg.desc': 'Прокси для Telegram',
      'modules.vpn.name': 'Jey2Ray',
      'modules.vpn.desc': 'VPN-клиент (VLESS, VMess, Trojan, SS, Hysteria2)',
      'modules.status.running': 'Активен',
      'modules.status.stopped': 'Остановлен',
      'modules.status.error': 'Ошибка',
      'modules.start': 'Запустить',
      'modules.stop': 'Остановить',
      'modules.dpi.sites': 'Сайты для обхода',
      'modules.dpi.add': 'Добавить домен',
      'modules.dpi.hint': 'Например: example.com',
      // VPN
      'vpn.title': 'Jey2Ray',
      'vpn.add': 'Добавить',
      'vpn.import': 'Вставить ссылку',
      'vpn.qr': 'Сканировать QR',
      'vpn.connect': 'Подключить',
      'vpn.disconnect': 'Отключить',
      'vpn.connected': 'Подключено',
      'vpn.disconnected': 'Выключено',
      'vpn.connecting': 'Подключение…',
      'vpn.mode.proxy': 'PROXY',
      'vpn.mode.tun': 'TUN',
      'vpn.subs': 'Подписки',
      'vpn.noProfiles': 'Нет профилей',
      'vpn.noProfilesHint': 'Добавьте ссылку, отсканируйте QR или импортируйте подписку.',
      'vpn.servers': 'серверов',
      'vpn.ping': 'Пинг',
      // подписки
      'subs.title': 'Подписки',
      'subs.add': 'Добавить подписку',
      'subs.refresh': 'Обновить',
      'subs.remove': 'Удалить',
      'subs.traffic': 'Трафик',
      'subs.expires': 'Истекает',
      'subs.interval': 'Автообновление',
      'subs.urlHint': 'https://… (ссылка подписки)',
      'subs.name': 'Название',
      // настройки
      'settings.title': 'Настройки',
      'settings.language': 'Язык',
      'settings.dns': 'DNS',
      'settings.dns.hint': 'Выбор DNS-сервера для VPN',
      'settings.autoConnect': 'Автоподключение VPN',
      'settings.subsInterval': 'Интервал обновления подписок',
      'settings.export': 'Экспорт подписок (JSON)',
      'settings.import': 'Импорт подписок (JSON)',
      'settings.logs': 'Журнал',
      'settings.about': 'О программе',
      'settings.theme': 'Тема',
      // логи
      'logs.title': 'Журнал',
      'logs.empty': 'Записей пока нет',
      'logs.clear': 'Очистить',
      // общее
      'common.save': 'Сохранить',
      'common.cancel': 'Отмена',
      'common.add': 'Добавить',
      'common.delete': 'Удалить',
      'common.error': 'Ошибка',
      'common.done': 'Готово',
      'common.loading': 'Загрузка…',
      'common.never': 'никогда',
      'common.hour': 'час',
      'common.hours': 'часа(ов)',
    },
    'en': {
      'nav.dashboard': 'Dashboard',
      'nav.modules': 'Modules',
      'nav.vpn': 'Jey2Ray',
      'nav.settings': 'Settings',
      'dashboard.title': 'NEXUS',
      'dashboard.tagline': 'Network control center',
      'dashboard.pulse': 'SYSTEM PULSE',
      'dashboard.live': 'LIVE',
      'dashboard.running': 'running',
      'dashboard.health': 'Health',
      'dashboard.modules': 'Modules',
      'dashboard.lastScan': 'Last scan',
      'dashboard.quick': 'Quick access',
      'dashboard.all': 'All modules',
      'modules.title': 'Modules',
      'modules.dpi.name': 'DPI Bypass',
      'modules.dpi.desc': 'YouTube, Discord, Instagram, X, TikTok',
      'modules.tg.name': 'TG WS Proxy',
      'modules.tg.desc': 'Proxy for Telegram',
      'modules.vpn.name': 'Jey2Ray',
      'modules.vpn.desc': 'VPN client (VLESS, VMess, Trojan, SS, Hysteria2)',
      'modules.status.running': 'Active',
      'modules.status.stopped': 'Stopped',
      'modules.status.error': 'Error',
      'modules.start': 'Start',
      'modules.stop': 'Stop',
      'modules.dpi.sites': 'Bypass sites',
      'modules.dpi.add': 'Add domain',
      'modules.dpi.hint': 'e.g. example.com',
      'vpn.title': 'Jey2Ray',
      'vpn.add': 'Add',
      'vpn.import': 'Paste link',
      'vpn.qr': 'Scan QR',
      'vpn.connect': 'Connect',
      'vpn.disconnect': 'Disconnect',
      'vpn.connected': 'Connected',
      'vpn.disconnected': 'Disconnected',
      'vpn.connecting': 'Connecting…',
      'vpn.mode.proxy': 'PROXY',
      'vpn.mode.tun': 'TUN',
      'vpn.subs': 'Subscriptions',
      'vpn.noProfiles': 'No profiles',
      'vpn.noProfilesHint': 'Add a link, scan a QR or import a subscription.',
      'vpn.servers': 'servers',
      'vpn.ping': 'Ping',
      'subs.title': 'Subscriptions',
      'subs.add': 'Add subscription',
      'subs.refresh': 'Refresh',
      'subs.remove': 'Remove',
      'subs.traffic': 'Traffic',
      'subs.expires': 'Expires',
      'subs.interval': 'Auto refresh',
      'subs.urlHint': 'https://… (subscription link)',
      'subs.name': 'Name',
      'settings.title': 'Settings',
      'settings.language': 'Language',
      'settings.dns': 'DNS',
      'settings.dns.hint': 'DNS server for VPN',
      'settings.autoConnect': 'VPN auto-connect',
      'settings.subsInterval': 'Subscription refresh interval',
      'settings.export': 'Export subscriptions (JSON)',
      'settings.import': 'Import subscriptions (JSON)',
      'settings.logs': 'Log',
      'settings.about': 'About',
      'settings.theme': 'Theme',
      'logs.title': 'Log',
      'logs.empty': 'No entries yet',
      'logs.clear': 'Clear',
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.add': 'Add',
      'common.delete': 'Delete',
      'common.error': 'Error',
      'common.done': 'Done',
      'common.loading': 'Loading…',
      'common.never': 'never',
      'common.hour': 'hour',
      'common.hours': 'hours',
    },
  };
}

class _AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) => ['ru', 'en'].contains(locale.languageCode);

  @override
  Future<AppLocalizations> load(Locale locale) async =>
      AppLocalizations(locale);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}
