import 'vpn_profile.dart';

/// Подписка на серверы провайдера (совместима с десктопным NEXUS по JSON).
class Subscription {
  Subscription({
    required this.id,
    required this.url,
    required this.title,
    this.updateHours = 12,
    this.lastSync,
    this.expiresAt,
    this.upload = 0,
    this.download = 0,
    this.enabled = true,
    this.profiles = const [],
  });

  final String id;
  final String url;
  String title;

  /// Интервал автообновления в часах (1–24).
  int updateHours;

  DateTime? lastSync;
  DateTime? expiresAt;
  int upload;
  int download;
  bool enabled;
  List<VpnProfile> profiles;

  int get totalBytes => upload + download;
  int get serverCount => profiles.length;

  Map<String, dynamic> toJson() => {
        'id': id,
        'url': url,
        'title': title,
        'updateHours': updateHours,
        'lastSync': lastSync?.toIso8601String(),
        'expiresAt': expiresAt?.toIso8601String(),
        'upload': upload,
        'download': download,
        'enabled': enabled,
        'profiles': profiles.map((p) => p.toJson()).toList(),
      };

  factory Subscription.fromJson(Map<String, dynamic> json) => Subscription(
        id: json['id'] as String,
        url: json['url'] as String,
        title: json['title'] as String,
        updateHours: json['updateHours'] as int? ?? 12,
        lastSync: json['lastSync'] != null
            ? DateTime.tryParse(json['lastSync'] as String)
            : null,
        expiresAt: json['expiresAt'] != null
            ? DateTime.tryParse(json['expiresAt'] as String)
            : null,
        upload: json['upload'] as int? ?? 0,
        download: json['download'] as int? ?? 0,
        enabled: json['enabled'] as bool? ?? true,
        profiles: (json['profiles'] as List? ?? const [])
            .map((e) => VpnProfile.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList(),
      );
}
