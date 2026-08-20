import '../models/vpn_profile.dart';
import 'vpn_engine_mock.dart';

/// Состояние VPN-подключения.
enum VpnStatus { disconnected, connecting, connected, error }

/// Снимок состояния движка.
class VpnState {
  const VpnState({
    required this.status,
    this.profileId,
    this.message,
  });

  final VpnStatus status;
  final String? profileId;
  final String? message;

  bool get isConnected => status == VpnStatus.connected;
}

/// Абстракция VPN-движка (sing-box / Xray-core через нативный плагин).
///
/// Реальная реализация — см. `doc/vpn_engine_v2ray.example.dart`.
/// По умолчанию используется [MockVpnEngine], чтобы приложение работало
/// без нативных зависимостей (демо-режим).
abstract class VpnEngine {
  Stream<VpnState> get states;
  VpnState get current;

  /// Режим: 'proxy' (только браузер) или 'tun' (весь трафик).
  String mode = 'proxy';

  Future<void> start(VpnProfile profile, {String? mode});
  Future<void> stop();

  /// Замер задержки до сервера (мс). null — недоступен.
  Future<int?> ping(VpnProfile profile);

  Future<void> dispose();
}

/// Фабрика движка. Здесь выбирается реализация.
class VpnEngineFactory {
  VpnEngineFactory._();

  /// В демо-режиме всегда mock. Для реального движка верните реализацию
  /// из `doc/vpn_engine_v2ray.example.dart`.
  static VpnEngine create() => MockVpnEngine();
}
