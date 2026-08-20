import 'dart:convert';

import 'package:uuid/uuid.dart';

import '../models/vpn_profile.dart';

/// Парсер ссылок VLESS / VMess / Trojan / Shadowsocks / Hysteria2.
class ProfileParser {
  static const _uuid = Uuid();

  /// Парсит одну ссылку в профиль. Бросает [FormatException] при ошибке.
  static VpnProfile parse(String link) {
    final trimmed = link.trim();
    final scheme = trimmed.split('://').first.toLowerCase();

    switch (scheme) {
      case 'vless':
        return _parseVless(trimmed);
      case 'vmess':
        return _parseVmess(trimmed);
      case 'trojan':
        return _parseTrojan(trimmed);
      case 'ss':
        return _parseShadowsocks(trimmed);
      case 'hy2':
      case 'hysteria2':
        return _parseHysteria2(trimmed);
      default:
        throw FormatException('Неподдерживаемый протокол: $scheme');
    }
  }

  /// Парсит список ссылок (по одной на строку) или base64-блок подписки.
  static List<VpnProfile> parseMany(String content) {
    final profiles = <VpnProfile>[];
    for (final line in _lines(content)) {
      if (line.isEmpty) continue;
      try {
        profiles.add(parse(line));
      } catch (_) {/* пропускаем невалидные строки */}
    }
    return profiles;
  }

  static List<String> _lines(String content) {
    // Подписки часто приходят как base64(ссылки\nссылки...).
    final trimmed = content.trim();
    if (_looksLikeBase64(trimmed) &&
        !trimmed.contains('://') &&
        !trimmed.contains('\n')) {
      try {
        final decoded = utf8.decode(base64Decode(trimmed));
        return decoded.split(RegExp(r'\r?\n'));
      } catch (_) {/* не base64 — вернём как есть */}
    }
    return trimmed.split(RegExp(r'\r?\n'));
  }

  static bool _looksLikeBase64(String s) =>
      s.length > 8 && RegExp(r'^[A-Za-z0-9+/=\s]+$').hasMatch(s);

  static VpnProfile _parseVless(String link) {
    final uri = Uri.parse(link);
    final query = uri.queryParameters;
    final name = _fragmentName(uri, query, 'VLESS');
    return VpnProfile(
      id: _uuid.v4(),
      name: name,
      protocol: 'vless',
      address: uri.host,
      port: uri.port,
      country: _extractCountry(uri.fragment),
      extra: {
        'uuid': uri.userInfo,
        'security': query['security'] ?? 'auto',
        'sni': query['sni'] ?? '',
        'type': query['type'] ?? 'tcp',
        'flow': query['flow'] ?? '',
        'fragment': query['fp'] ?? '',
      },
      rawLink: link,
    );
  }

  static VpnProfile _parseVmess(String link) {
    final raw = link.substring('vmess://'.length);
    final json = jsonDecode(utf8.decode(base64Decode(base64.normalize(raw)))) as Map<String, dynamic>;
    final name = (json['ps'] as String?) ?? 'VMess';
    return VpnProfile(
      id: _uuid.v4(),
      name: name,
      protocol: 'vmess',
      country: _extractCountry(name),
      address: json['add'] as String? ?? '',
      port: int.tryParse(json['port']?.toString() ?? '0') ?? 0,
      extra: {
        'uuid': json['id'] as String? ?? '',
        'security': json['scy'] as String? ?? 'auto',
        'type': json['net'] as String? ?? 'tcp',
        'sni': json['sni'] as String? ?? '',
      },
      rawLink: link,
    );
  }

  static VpnProfile _parseTrojan(String link) {
    final uri = Uri.parse(link);
    final query = uri.queryParameters;
    return VpnProfile(
      id: _uuid.v4(),
      name: _fragmentName(uri, query, 'Trojan'),
      protocol: 'trojan',
      country: _extractCountry(uri.fragment),
      address: uri.host,
      port: uri.port,
      extra: {
        'password': uri.userInfo,
        'sni': query['sni'] ?? '',
        'type': query['type'] ?? 'tcp',
      },
      rawLink: link,
    );
  }

  static VpnProfile _parseShadowsocks(String link) {
    // Форматы: ss://base64(method:pass)@host:port#name
    //          ss://method:pass@host:port#name (SIP002)
    var body = link.substring('ss://'.length);
    var method = '';
    var password = '';

    if (!body.contains('@')) {
      throw const FormatException('Некорректная ссылка ss://');
    }

    final at = body.indexOf('@');
    final userinfo = body.substring(0, at);
    body = body.substring(at + 1);

    if (userinfo.contains(':')) {
      final parts = userinfo.split(':');
      method = parts[0];
      password = parts.length > 1 ? parts[1] : '';
    } else {
      final decoded = utf8.decode(base64Decode(base64.normalize(userinfo)));
      final idx = decoded.indexOf(':');
      method = decoded.substring(0, idx);
      password = decoded.substring(idx + 1);
    }

    final fragmentIdx = body.indexOf('#');
    var name = 'Shadowsocks';
    if (fragmentIdx >= 0) {
      name = Uri.decodeComponent(body.substring(fragmentIdx + 1));
      body = body.substring(0, fragmentIdx);
    }
    final hostport = body.split(':');
    final host = hostport[0];
    final port = hostport.length > 1 ? int.tryParse(hostport[1]) ?? 0 : 0;

    return VpnProfile(
      id: _uuid.v4(),
      name: name,
      protocol: 'shadowsocks',
      country: _extractCountry(name),
      address: host,
      port: port,
      extra: {'method': method, 'password': password},
      rawLink: link,
    );
  }

  static VpnProfile _parseHysteria2(String link) {
    final uri = Uri.parse(link);
    final query = uri.queryParameters;
    return VpnProfile(
      id: _uuid.v4(),
      name: _fragmentName(uri, query, 'Hysteria2'),
      protocol: 'hysteria2',
      country: _extractCountry(uri.fragment),
      address: uri.host,
      port: uri.port,
      extra: {
        'password': uri.userInfo,
        'sni': query['sni'] ?? '',
        'insecure': query['insecure'] ?? '0',
      },
      rawLink: link,
    );
  }

  static String _fragmentName(Uri uri, Map<String, String> query, String fallback) {
    if (uri.fragment.isNotEmpty) return uri.fragment;
    final remark = query['remark'];
    if (remark != null && remark.isNotEmpty) return remark;
    return '$fallback ${uri.host}';
  }

  /// Пытается достать двухбуквенный код страны из конца названия/фрагмента.
  static String? _extractCountry(String? fragment) {
    if (fragment == null || fragment.trim().isEmpty) return null;
    String decoded;
    try {
      decoded = Uri.decodeComponent(fragment).trim();
    } catch (_) {
      decoded = fragment.trim();
    }
    final m = RegExp(r'([A-Za-z]{2})$').firstMatch(decoded);
    if (m == null) return null;
    final code = m.group(1)!.toUpperCase();
    const known = {
      'DE', 'NL', 'FI', 'SE', 'US', 'GB', 'JP', 'SG', 'HK', 'RU', 'UA', 'FR',
      'IT', 'ES', 'PL', 'CH', 'TR', 'CA', 'AU', 'IN', 'BR', 'KR', 'NO', 'DK',
      'CZ', 'RO', 'BG', 'RS', 'KZ', 'GE', 'AM', 'AE', 'IL', 'TH', 'VN', 'ID',
      'MY', 'TW', 'CN', 'AT', 'BE', 'GR', 'PT', 'HU', 'SK', 'HR', 'SI', 'LT',
      'LV', 'EE', 'IE', 'IS', 'LU', 'MT', 'CY', 'BY', 'AZ', 'UZ', 'KG', 'TJ',
    };
    return known.contains(code) ? code : null;
  }
}
