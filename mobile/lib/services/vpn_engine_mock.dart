import 'dart:async';
import 'dart:math';

import '../models/vpn_profile.dart';
import 'vpn_engine.dart';

/// Демо-движок: эмулирует подключение, пинг и статусы без нативных модулей.
class MockVpnEngine implements VpnEngine {
  final _controller = StreamController<VpnState>.broadcast();
  final _rand = Random();
  VpnState _current = const VpnState(status: VpnStatus.disconnected);

  @override
  VpnState get current => _current;

  @override
  Stream<VpnState> get states => _controller.stream;

  @override
  String mode = 'proxy';

  void _emit(VpnState state) {
    _current = state;
    _controller.add(state);
  }

  @override
  Future<void> start(VpnProfile profile, {String? mode}) async {
    if (mode != null) this.mode = mode;
    _emit(VpnState(
      status: VpnStatus.connecting,
      profileId: profile.id,
      message: profile.name,
    ));
    await Future.delayed(const Duration(milliseconds: 900));
    _emit(VpnState(
      status: VpnStatus.connected,
      profileId: profile.id,
      message: profile.name,
    ));
  }

  @override
  Future<void> stop() async {
    _emit(const VpnState(status: VpnStatus.disconnected));
  }

  @override
  Future<int?> ping(VpnProfile profile) async {
    await Future.delayed(const Duration(milliseconds: 200));
    return 25 + _rand.nextInt(180);
  }

  @override
  Future<void> dispose() async {
    await _controller.close();
  }
}
