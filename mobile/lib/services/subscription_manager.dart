import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import 'package:yaml/yaml.dart';

import '../core/logger.dart';
import '../core/security.dart';
import '../models/subscription.dart';
import '../models/vpn_profile.dart';
import 'profile_parser.dart';
import 'storage_service.dart';
import 'vpn_engine.dart';

/// Управление подписками: добавление, автообновление, удаление, импорт/экспорт.
class SubscriptionManager extends ChangeNotifier {
  SubscriptionManager(this._storage, this._engine);

  final StorageService _storage;
  final VpnEngine _engine;
  final Dio _dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 20),
  ));

  List<Subscription> _subscriptions = [];
  List<Subscription> get subscriptions => List.unmodifiable(_subscriptions);

  Timer? _autoRefreshTimer;
  int _refreshHours = 12;

  Future<void> load() async {
    _subscriptions = await _storage.loadSubscriptions();
    notifyListeners();
  }

  void configureAutoRefresh(int hours) {
    _refreshHours = hours;
    _autoRefreshTimer?.cancel();
    _autoRefreshTimer = Timer.periodic(const Duration(minutes: 1), (_) => _tick());
  }

  void _tick() {
    final now = DateTime.now();
    for (final sub in _subscriptions.where((s) => s.enabled)) {
      final last = sub.lastSync;
      if (last == null ||
          now.difference(last).inHours >= sub.updateHours) {
        refresh(sub.id);
      }
    }
  }

  /// Добавляет подписку по HTTPS-ссылке.
  Future<Subscription> add(String url, {String? title}) async {
    AppLogger.instance.info('subscription', 'Загрузка подписки: $url');
    final profiles = await _fetchProfiles(url);
    if (profiles.isEmpty) {
      throw Exception('В подписке не найдено серверов');
    }
    final sub = Subscription(
      id: const Uuid().v4(),
      url: url,
      title: title ?? _guessTitle(url, profiles.first),
      updateHours: _refreshHours,
      lastSync: DateTime.now(),
      profiles: profiles,
    );
    _subscriptions.insert(0, sub);
    notifyListeners();
    await _storage.saveSubscription(sub);
    AppLogger.instance.success('subscription', 'Добавлено серверов: ${profiles.length}');
    return sub;
  }

  /// Обновляет подписку и её серверы.
  Future<void> refresh(String id) async {
    final index = _subscriptions.indexWhere((s) => s.id == id);
    if (index < 0) return;
    final sub = _subscriptions[index];
    try {
      final profiles = await _fetchProfiles(sub.url);
      if (profiles.isEmpty) {
        AppLogger.instance.warn('subscription', 'Подписка "${sub.title}" пуста');
        return;
      }
      final updated = Subscription(
        id: sub.id,
        url: sub.url,
        title: sub.title,
        updateHours: sub.updateHours,
        lastSync: DateTime.now(),
        expiresAt: sub.expiresAt,
        upload: sub.upload,
        download: sub.download,
        enabled: sub.enabled,
        profiles: profiles,
      );
      _subscriptions[index] = updated;
      notifyListeners();
      await _storage.saveSubscription(updated);
      AppLogger.instance.success('subscription', 'Подписка "${sub.title}" обновлена');
    } catch (e) {
      AppLogger.instance.error('subscription', 'Ошибка обновления: $e');
    }
  }

  Future<void> remove(String id) async {
    _subscriptions.removeWhere((s) => s.id == id);
    notifyListeners();
    await _storage.deleteSubscription(id);
    AppLogger.instance.info('subscription', 'Подписка удалена');
  }

  Future<List<VpnProfile>> _fetchProfiles(String url) async {
    final response = await _dio.get<String>(url);
    final content = response.data ?? '';

    // Сначала пробуем список ссылок (plain или base64).
    var profiles = ProfileParser.parseMany(content);
    if (profiles.isNotEmpty) return profiles;

    // Затем — Clash YAML.
    profiles = _parseClash(content);
    return profiles;
  }

  List<VpnProfile> _parseClash(String content) {
    try {
      final doc = loadYaml(content);
      if (doc is! Map) return const [];
      final proxies = doc['proxies'];
      if (proxies is! YamlList) return const [];
      final result = <VpnProfile>[];
      final uuid = const Uuid();
      for (final raw in proxies) {
        if (raw is! Map) continue;
        final type = (raw['type'] as String?)?.toLowerCase() ?? '';
        final name = (raw['name'] as String?) ?? 'Clash';
        final server = (raw['server'] as String?) ?? '';
        final port = int.tryParse((raw['port'] ?? '').toString()) ?? 0;
        if (server.isEmpty || port == 0) continue;

        switch (type) {
          case 'vless':
            result.add(VpnProfile(
              id: uuid.v4(), name: name, protocol: 'vless',
              address: server, port: port,
              extra: {
                'uuid': (raw['uuid'] as String?) ?? '',
                'security': (raw['tls'] as bool? ?? false) ? 'tls' : 'none',
                'sni': (raw['servername'] as String?) ?? '',
                'type': (raw['network'] as String?) ?? 'tcp',
              },
            ));
            break;
          case 'vmess':
            result.add(VpnProfile(
              id: uuid.v4(), name: name, protocol: 'vmess',
              address: server, port: port,
              extra: {
                'uuid': (raw['uuid'] as String?) ?? '',
                'security': (raw['cipher'] as String?) ?? 'auto',
                'type': (raw['network'] as String?) ?? 'tcp',
              },
            ));
            break;
          case 'trojan':
            result.add(VpnProfile(
              id: uuid.v4(), name: name, protocol: 'trojan',
              address: server, port: port,
              extra: {
                'password': (raw['password'] as String?) ?? '',
                'sni': (raw['sni'] as String?) ?? '',
              },
            ));
            break;
          case 'ss':
          case 'shadowsocks':
            result.add(VpnProfile(
              id: uuid.v4(), name: name, protocol: 'shadowsocks',
              address: server, port: port,
              extra: {
                'method': (raw['cipher'] as String?) ?? 'aes-256-gcm',
                'password': (raw['password'] as String?) ?? '',
              },
            ));
            break;
          case 'hysteria2':
          case 'hy2':
            result.add(VpnProfile(
              id: uuid.v4(), name: name, protocol: 'hysteria2',
              address: server, port: port,
              extra: {
                'password': (raw['password'] as String?) ?? '',
                'sni': (raw['sni'] as String?) ?? '',
              },
            ));
            break;
        }
      }
      return result;
    } catch (_) {
      return const [];
    }
  }

  String _guessTitle(String url, VpnProfile first) {
    final uri = Uri.tryParse(url);
    if (uri != null && uri.host.isNotEmpty) return uri.host;
    return first.name;
  }

  // ---------------- импорт / экспорт (совместимо с десктопным NEXUS) --------

  /// JSON, совместимый с десктопным NEXUS: список подписок + профили.
  String exportJson() {
    final payload = {
      'format': 'nexus-subscriptions',
      'version': 1,
      'subscriptions': _subscriptions.map((s) => s.toJson()).toList(),
    };
    return const JsonEncoder.withIndent('  ').convert(payload);
  }

  Future<int> importJson(String raw) async {
    final decoded = jsonDecode(raw);
    final subs = (decoded as Map)['subscriptions'] as List? ?? const [];
    var count = 0;
    for (final item in subs) {
      final sub = Subscription.fromJson(Map<String, dynamic>.from(item as Map));
      _subscriptions.add(sub);
      await _storage.saveSubscription(sub);
      count += sub.profiles.length;
    }
    notifyListeners();
    return count;
  }

  Future<void> dispose() async {
    _autoRefreshTimer?.cancel();
  }
}
