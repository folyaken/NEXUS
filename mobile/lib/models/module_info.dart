/// Состояние модуля.
enum ModuleStatus { stopped, starting, running, error }

/// Идентификаторы встроенных модулей.
enum ModuleId { dpi, tgProxy, vpn }

/// Описание встроенного модуля (аналог карточек десктопного NEXUS).
class ModuleInfo {
  ModuleInfo({
    required this.id,
    required this.icon,
    required this.nameKey,
    required this.descKey,
    this.status = ModuleStatus.stopped,
    this.extra = '',
  });

  final ModuleId id;
  final String icon;
  final String nameKey;
  final String descKey;
  ModuleStatus status;

  /// Дополнительная строка (порт, PID, стратегия и т.п.).
  String extra;

  bool get isRunning => status == ModuleStatus.running;
}
