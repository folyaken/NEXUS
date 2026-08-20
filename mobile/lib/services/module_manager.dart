import 'package:flutter/foundation.dart';

import '../core/logger.dart';
import '../models/module_info.dart';
import 'vpn_engine.dart';

/// Управление встроенными модулями: Обход DPI, TG WS Proxy, Jey2Ray.
class ModuleManager extends ChangeNotifier {
  ModuleManager(this._engine) {
    _modules = {
      ModuleId.dpi: ModuleInfo(
        id: ModuleId.dpi,
        icon: '🛡️',
        nameKey: 'modules.dpi.name',
        descKey: 'modules.dpi.desc',
        extra: 'Auto-fragment',
      ),
      ModuleId.tgProxy: ModuleInfo(
        id: ModuleId.tgProxy,
        icon: '✈️',
        nameKey: 'modules.tg.name',
        descKey: 'modules.tg.desc',
        extra: 'MTProto · 8080',
      ),
      ModuleId.vpn: ModuleInfo(
        id: ModuleId.vpn,
        icon: '◈',
        nameKey: 'modules.vpn.name',
        descKey: 'modules.vpn.desc',
      ),
    };
  }

  final VpnEngine _engine;
  late final Map<ModuleId, ModuleInfo> _modules;

  List<ModuleInfo> get modules =>
      ModuleId.values.map((id) => _modules[id]!).toList();

  ModuleInfo? byId(ModuleId id) => _modules[id];

  int get runningCount => _modules.values.where((m) => m.isRunning).length;
  int get totalCount => _modules.length;

  /// Включает/выключает модуль.
  Future<void> toggle(ModuleId id) async {
    final module = _modules[id]!;
    if (module.isRunning) {
      await stop(id);
    } else {
      await start(id);
    }
  }

  Future<void> start(ModuleId id) async {
    final module = _modules[id]!;
    module.status = ModuleStatus.starting;
    notifyListeners();
    AppLogger.instance.info('module', 'Запуск: ${module.nameKey}');
    await Future.delayed(const Duration(milliseconds: 700));

    switch (id) {
      case ModuleId.dpi:
        // В реальном приложении — старт sing-box/Xray с маршрутизацией сайтов.
        module.extra = 'Auto-fragment · ON';
        break;
      case ModuleId.tgProxy:
        // В реальном приложении — нативный tg-ws-proxy foreground service.
        module.extra = 'MTProto · 8080 · foreground';
        break;
      case ModuleId.vpn:
        module.extra = 'Xray-core';
        break;
    }

    module.status = ModuleStatus.running;
    notifyListeners();
    AppLogger.instance.success('module', 'Модуль запущен: ${module.nameKey}');
  }

  Future<void> stop(ModuleId id) async {
    final module = _modules[id]!;
    module.status = ModuleStatus.stopped;
    module.extra = id == ModuleId.tgProxy ? 'MTProto · 8080' : 'Остановлен';
    notifyListeners();
    if (id == ModuleId.vpn) {
      await _engine.stop();
    }
    AppLogger.instance.info('module', 'Модуль остановлен: ${module.nameKey}');
  }

  /// «Отключить всё» — останавливает VPN и все модули разом.
  Future<void> stopAll() async {
    for (final id in ModuleId.values) {
      if (_modules[id]!.isRunning) await stop(id);
    }
  }
}
