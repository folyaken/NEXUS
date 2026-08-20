/// Глобальные константы приложения.
class AppConstants {
  AppConstants._();

  /// Версия приложения (синхронизируется с pubspec при релизе).
  static const String appVersion = '1.0.0';

  /// Идентификатор приложения для хранилища.
  static const String storageNamespace = 'nexus_mobile';

  /// Названия протоколов, поддерживаемых Jey2Ray.
  static const List<String> vpnProtocols = [
    'vless',
    'vmess',
    'trojan',
    'shadowsocks',
    'hysteria2',
  ];

  /// Пресеты DNS-серверов (Jey2Ray → Настройки).
  static const Map<String, String> dnsPresets = {
    'cloudflare': '1.1.1.1',
    'google': '8.8.8.8',
    'adguard': '94.140.14.14',
    'quad9': '9.9.9.9',
  };

  /// Список сайтов для обхода DPI по умолчанию.
  static const List<String> defaultDpiSites = [
    'youtube.com',
    'discord.com',
    'instagram.com',
    'x.com',
    'twitter.com',
    'tiktok.com',
  ];
}
