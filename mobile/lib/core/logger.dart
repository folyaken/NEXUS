import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/log_entry.dart';

/// Журнал приложения: хранит записи в памяти и периодически в SharedPreferences.
class AppLogger extends ChangeNotifier {
  AppLogger._();
  static final AppLogger instance = AppLogger._();

  static const _prefsKey = 'nexus_log_entries';
  static const _maxEntries = 300;

  final List<LogEntry> _entries = [];
  List<LogEntry> get entries => List.unmodifiable(_entries);

  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_prefsKey);
      if (raw == null) return;
      final list = jsonDecode(raw) as List;
      _entries
        ..clear()
        ..addAll(list
            .map((e) => LogEntry.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList());
      notifyListeners();
    } catch (e) {
      debugPrint('logger.load: $e');
    }
  }

  void info(String source, String message) => _add('info', source, message);
  void success(String source, String message) => _add('success', source, message);
  void warn(String source, String message) => _add('warn', source, message);
  void error(String source, String message) => _add('error', source, message);

  void _add(String level, String source, String message) {
    _entries.insert(
      0,
      LogEntry(time: DateTime.now(), level: level, source: source, message: message),
    );
    if (_entries.length > _maxEntries) _entries.removeRange(_maxEntries, _entries.length);
    debugPrint('[$level] [$source] $message');
    notifyListeners();
    _persist();
  }

  Future<void> _persist() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _prefsKey,
        jsonEncode(_entries.map((e) => e.toJson()).toList()),
      );
    } catch (_) {/* не критично */}
  }

  Future<void> clear() async {
    _entries.clear();
    notifyListeners();
    await _persist();
  }
}
