import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';

import '../core/constants.dart';
import '../core/security.dart';
import '../models/app_settings.dart';
import '../models/subscription.dart';
import '../models/vpn_profile.dart';

/// Хранилище: SharedPreferences (настройки) + SQLite (подписки и профили).
///
/// На Android/iOS используется SQLite. На десктопе (Windows/Linux), где плагин
/// sqflite недоступен, приложение автоматически переходит в режим хранения
/// в памяти — чтобы превью интерфейса работало без ошибок.
class StorageService {
  Database? _db;

  /// Запасной режим «в памяти» для десктопа.
  final List<Subscription> _memSubs = [];
  final List<VpnProfile> _memProfiles = [];

  bool get _isMemory => _db == null;

  Future<void> init() async {
    try {
      final dir = await getDatabasesPath();
      final path = p.join(dir, '${AppConstants.storageNamespace}.db');
      _db = await openDatabase(
        path,
        version: 1,
        onCreate: (db, version) async {
          await db.execute('''
            CREATE TABLE subscriptions(
              id TEXT PRIMARY KEY,
              url TEXT NOT NULL,
              title TEXT NOT NULL,
              update_hours INTEGER NOT NULL,
              last_sync TEXT,
              expires_at TEXT,
              upload INTEGER NOT NULL DEFAULT 0,
              download INTEGER NOT NULL DEFAULT 0,
              enabled INTEGER NOT NULL DEFAULT 1
            )
          ''');
          await db.execute('''
            CREATE TABLE profiles(
              id TEXT PRIMARY KEY,
              subscription_id TEXT,
              name TEXT NOT NULL,
              protocol TEXT NOT NULL,
              address TEXT NOT NULL,
              port INTEGER NOT NULL,
              extra TEXT,
              raw_link TEXT
            )
          ''');
          await db.execute(
            'CREATE INDEX idx_profiles_sub ON profiles(subscription_id)',
          );
        },
      );
    } catch (e) {
      // sqflite не поддерживает эту платформу (десктоп) — работаем в памяти.
      debugPrint('storage.init: SQLite недоступен, режим в памяти ($e)');
      _db = null;
    }
  }

  // ---------------- settings ----------------

  Future<AppSettings> loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('${AppConstants.storageNamespace}_settings');
    if (raw == null) return AppSettings();
    try {
      return AppSettings.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return AppSettings();
    }
  }

  Future<void> saveSettings(AppSettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      '${AppConstants.storageNamespace}_settings',
      jsonEncode(settings.toJson()),
    );
  }

  // ---------------- subscriptions ----------------

  Future<void> saveSubscription(Subscription sub) async {
    if (_isMemory) {
      _memSubs.removeWhere((s) => s.id == sub.id);
      _memSubs.add(sub);
      return;
    }
    final db = _db!;
    final storedUrl = await AesCipher.encrypt(sub.url);
    await db.transaction((txn) async {
      await txn.insert(
        'subscriptions',
        {
          'id': sub.id,
          'url': storedUrl,
          'title': sub.title,
          'update_hours': sub.updateHours,
          'last_sync': sub.lastSync?.toIso8601String(),
          'expires_at': sub.expiresAt?.toIso8601String(),
          'upload': sub.upload,
          'download': sub.download,
          'enabled': sub.enabled ? 1 : 0,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
      await txn.delete('profiles', where: 'subscription_id = ?', whereArgs: [sub.id]);
      for (final profile in sub.profiles) {
        await txn.insert(
          'profiles',
          {
            'id': profile.id,
            'subscription_id': sub.id,
            'name': profile.name,
            'protocol': profile.protocol,
            'address': profile.address,
            'port': profile.port,
            'extra': jsonEncode(_extraWithCountry(profile)),
            'raw_link': profile.rawLink,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    });
  }

  Future<List<Subscription>> loadSubscriptions() async {
    if (_isMemory) return List.unmodifiable(_memSubs);
    final db = _db!;
    final rows = await db.query('subscriptions', orderBy: 'title');
    final result = <Subscription>[];
    for (final row in rows) {
      final profiles = await _profilesFor(row['id'] as String);
      String url = '';
      try {
        url = await AesCipher.decrypt(row['url'] as String);
      } catch (_) {
        url = row['url'] as String;
      }
      result.add(Subscription(
        id: row['id'] as String,
        url: url,
        title: row['title'] as String,
        updateHours: row['update_hours'] as int,
        lastSync: row['last_sync'] != null
            ? DateTime.tryParse(row['last_sync'] as String)
            : null,
        expiresAt: row['expires_at'] != null
            ? DateTime.tryParse(row['expires_at'] as String)
            : null,
        upload: row['upload'] as int,
        download: row['download'] as int,
        enabled: (row['enabled'] as int) == 1,
        profiles: profiles,
      ));
    }
    return result;
  }

  Future<void> deleteSubscription(String id) async {
    if (_isMemory) {
      _memSubs.removeWhere((s) => s.id == id);
      return;
    }
    final db = _db!;
    await db.transaction((txn) async {
      await txn.delete('profiles', where: 'subscription_id = ?', whereArgs: [id]);
      await txn.delete('subscriptions', where: 'id = ?', whereArgs: [id]);
    });
  }

  Future<List<VpnProfile>> _profilesFor(String subscriptionId) async {
    final db = _db!;
    final rows = await db.query(
      'profiles',
      where: 'subscription_id = ?',
      whereArgs: [subscriptionId],
      orderBy: 'name',
    );
    return rows.map((r) => _profileFromRow(
          r,
          subscriptionId: subscriptionId,
        )).toList();
  }

  // ---------------- ручные профили ----------------

  Future<void> saveProfile(VpnProfile profile) async {
    if (_isMemory) {
      _memProfiles.removeWhere((p) => p.id == profile.id);
      _memProfiles.add(profile);
      return;
    }
    await _db!.insert(
      'profiles',
      {
        'id': profile.id,
        'subscription_id': profile.subscriptionId,
        'name': profile.name,
        'protocol': profile.protocol,
        'address': profile.address,
        'port': profile.port,
        'extra': jsonEncode(_extraWithCountry(profile)),
        'raw_link': profile.rawLink,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<VpnProfile>> loadManualProfiles() async {
    if (_isMemory) {
      return List.unmodifiable(_memProfiles);
    }
    final rows = await _db!.query('profiles', where: 'subscription_id IS NULL');
    return rows.map((r) => _profileFromRow(r)).toList();
  }

  Future<void> deleteProfile(String id) async {
    if (_isMemory) {
      _memProfiles.removeWhere((p) => p.id == id);
      return;
    }
    await _db!.delete('profiles', where: 'id = ?', whereArgs: [id]);
  }

  /// Кладёт страну в extra (без отдельной колонки в схеме).
  Map<String, String> _extraWithCountry(VpnProfile profile) {
    final map = Map<String, String>.from(profile.extra);
    if (profile.country != null && profile.country!.isNotEmpty) {
      map['country'] = profile.country!;
    }
    return map;
  }

  /// Восстанавливает профиль из строки БД, вынимая страну из extra.
  VpnProfile _profileFromRow(Map<String, Object?> r, {String? subscriptionId}) {
    final extra =
        Map<String, String>.from(jsonDecode((r['extra'] as String?) ?? '{}') as Map);
    final country = extra.remove('country');
    return VpnProfile(
      id: r['id'] as String,
      name: r['name'] as String,
      protocol: r['protocol'] as String,
      address: r['address'] as String,
      port: r['port'] as int,
      extra: extra,
      subscriptionId: subscriptionId ?? (r['subscription_id'] as String?),
      rawLink: r['raw_link'] as String?,
      country: country,
    );
  }
}
