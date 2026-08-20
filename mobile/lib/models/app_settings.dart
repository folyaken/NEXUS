import '../core/constants.dart';

/// Настройки приложения (хранятся в SharedPreferences).
class AppSettings {
  AppSettings({
    this.language = 'ru',
    this.dpiSites = AppConstants.defaultDpiSites,
    this.autoConnectVpn = false,
    this.vpnMode = 'proxy',
    this.lastVpnProfileId,
    this.subscriptionRefreshHours = 12,
    this.dnsPreset = 'cloudflare',
    this.customDns,
  });

  String language;
  List<String> dpiSites;
  bool autoConnectVpn;

  /// 'proxy' | 'tun'
  String vpnMode;
  String? lastVpnProfileId;
  int subscriptionRefreshHours;

  /// Ключ из [AppConstants.dnsPresets] или 'custom'.
  String dnsPreset;
  String? customDns;

  String get resolvedDns => dnsPreset == 'custom'
      ? (customDns ?? '1.1.1.1')
      : (AppConstants.dnsPresets[dnsPreset] ?? '1.1.1.1');

  Map<String, dynamic> toJson() => {
        'language': language,
        'dpiSites': dpiSites,
        'autoConnectVpn': autoConnectVpn,
        'vpnMode': vpnMode,
        'lastVpnProfileId': lastVpnProfileId,
        'subscriptionRefreshHours': subscriptionRefreshHours,
        'dnsPreset': dnsPreset,
        'customDns': customDns,
      };

  factory AppSettings.fromJson(Map<String, dynamic> json) => AppSettings(
        language: json['language'] as String? ?? 'ru',
        dpiSites: (json['dpiSites'] as List? ?? const [])
            .map((e) => e.toString())
            .toList(),
        autoConnectVpn: json['autoConnectVpn'] as bool? ?? false,
        vpnMode: json['vpnMode'] as String? ?? 'proxy',
        lastVpnProfileId: json['lastVpnProfileId'] as String?,
        subscriptionRefreshHours:
            json['subscriptionRefreshHours'] as int? ?? 12,
        dnsPreset: json['dnsPreset'] as String? ?? 'cloudflare',
        customDns: json['customDns'] as String?,
      );
}
