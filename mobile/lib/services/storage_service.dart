import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';

import '../core/constants.dart';
import '../models/app_settings.dart';
import '../models/subscription.dart';
import '../models/vpn_profile.dart';

/// Хранилище: SharedPreferences (настройки) + SQLite (подписки и профили).
class StorageService {
  Database? _db;

  Future<void> init() async {
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
  }

  Database get db => _db!;

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
    await db.transaction((txn) async {
      await txn.insert(
        'subscriptions',
        {
          'id': sub.id,
          'url': sub.url,
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
            'extra': jsonEncode(profile.extra),
            'raw_link': profile.rawLink,
          },
          conflictAlgorithm: ConflictAlgorithm.replace,
        );
      }
    });
  }

  Future<List<Subscription>> loadSubscriptions() async {
    final rows = await db.query('subscriptions', orderBy: 'title');
    final result = <Subscription>[];
    for (final row in rows) {
      final profiles = await _profilesFor(row['id'] as String);
      result.add(Subscription(
        id: row['id'] as String,
        url: row['url'] as String,
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
    await db.transaction((txn) async {
      await txn.delete('profiles', where: 'subscription_id = ?', whereArgs: [id]);
      await txn.delete('subscriptions', where: 'id = ?', whereArgs: [id]);
    });
  }

  Future<List<VpnProfile>> _profilesFor(String subscriptionId) async {
    final rows = await db.query(
      'profiles',
      where: 'subscription_id = ?',
      whereArgs: [subscriptionId],
      orderBy: 'name',
    );
    return rows.map((r) => VpnProfile(
          id: r['id'] as String,
          name: r['name'] as String,
          protocol: r['protocol'] as String,
          address: r['address'] as String,
          port: r['port'] as int,
          extra: Map<String, String>.from(
              jsonDecode((r['extra'] as String?) ?? '{}') as Map),
          subscriptionId: subscriptionId,
          rawLink: r['raw_link'] as String?,
        )).toList();
  }

  // ---------------- ручные профили ----------------

  Future<void> saveProfile(VpnProfile profile) async {
    await db.insert(
      'profiles',
      {
        'id': profile.id,
        'subscription_id': profile.subscriptionId,
        'name': profile.name,
        'protocol': profile.protocol,
        'address': profile.address,
        'port': profile.port,
        'extra': jsonEncode(profile.extra),
        'raw_link': profile.rawLink,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<VpnProfile>> loadManualProfiles() async {
    final rows = await db.query('profiles', where: 'subscription_id IS NULL');
    return rows.map((r) => VpnProfile(
          id: r['id'] as String,
          name: r['name'] as String,
          protocol: r['protocol'] as String,
          address: r['address'] as String,
          port: r['port'] as int,
          extra: Map<String, String>.from(
              jsonDecode((r['extra'] as String?) ?? '{}') as Map),
          rawLink: r['raw_link'] as String?,
        )).toList();
  }

  Future<void> deleteProfile(String id) async {
    await db.delete('profiles', where: 'id = ?', whereArgs: [id]);
  }
}
