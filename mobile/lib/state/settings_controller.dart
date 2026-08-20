import 'package:flutter/material.dart';

import '../models/app_settings.dart';
import '../services/storage_service.dart';

/// Глобальные настройки + текущая локаль интерфейса.
class SettingsController extends ChangeNotifier {
  SettingsController(this._storage);

  final StorageService _storage;
  AppSettings settings = AppSettings();

  Locale get locale => Locale(settings.language);

  Future<void> load() async {
    settings = await _storage.loadSettings();
    notifyListeners();
  }

  Future<void> update(AppSettings next) async {
    settings = next;
    notifyListeners();
    await _storage.saveSettings(next);
  }

  Future<void> setLanguage(String code) async {
    await update(AppSettings.fromJson({...settings.toJson(), 'language': code}));
  }
}
