/// Профиль VPN-сервера (VLESS / VMess / Trojan / Shadowsocks / Hysteria2).
class VpnProfile {
  VpnProfile({
    required this.id,
    required this.name,
    required this.protocol,
    required this.address,
    required this.port,
    this.extra = const {},
    this.subscriptionId,
    this.latencyMs,
    this.rawLink,
  });

  final String id;
  final String name;
  final String protocol;
  final String address;
  final int port;

  /// Протокол-специфичные поля: uuid/password/security/sni/fragment/obfs и т.д.
  final Map<String, String> extra;

  /// Идентификатор подписки, из которой пришёл профиль (null — ручной).
  final String? subscriptionId;

  /// Задержка в миллисекундах (null — ещё не замерялась).
  int? latencyMs;

  /// Исходная ссылка (vless://, vmess://…), для повторного импорта.
  final String? rawLink;

  String get displayAddress => '$address:$port';

  String get upperProtocol => protocol == 'shadowsocks' ? 'SS' : protocol.toUpperCase();

  VpnProfile copyWith({int? latencyMs}) => VpnProfile(
        id: id,
        name: name,
        protocol: protocol,
        address: address,
        port: port,
        extra: extra,
        subscriptionId: subscriptionId,
        latencyMs: latencyMs ?? this.latencyMs,
        rawLink: rawLink,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'protocol': protocol,
        'address': address,
        'port': port,
        'extra': extra,
        'subscriptionId': subscriptionId,
        'rawLink': rawLink,
      };

  factory VpnProfile.fromJson(Map<String, dynamic> json) => VpnProfile(
        id: json['id'] as String,
        name: json['name'] as String,
        protocol: json['protocol'] as String,
        address: json['address'] as String,
        port: json['port'] as int,
        extra: Map<String, String>.from(json['extra'] as Map? ?? const {}),
        subscriptionId: json['subscriptionId'] as String?,
        latencyMs: json['latencyMs'] as int?,
        rawLink: json['rawLink'] as String?,
      );
}
