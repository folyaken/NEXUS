// Пример подключения РЕАЛЬНОГО VPN-движка (sing-box / Xray-core).
//
// Файл намеренно назван `.example.dart`, чтобы не компилировался без плагина.
// Порядок включения:
//   1) добавьте в pubspec.yaml плагин (flutter_v2ray_plus или v2ray_box, см. README);
//   2) скопируйте этот файл в lib/services/vpn_engine_v2ray.dart;
//   3) в lib/services/vpn_engine.dart верните V2rayEngine() из VpnEngineFactory.create();
//   4) уточните вызовы под актуальное API плагина (см. README плагина на pub.dev).
//
// Псевдокод ниже иллюстрирует структуру — реальные сигнатуры методов
// зависят от версии плагина.

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/vpn_profile.dart';
import 'vpn_engine.dart';

class V2rayEngine implements VpnEngine {
  final _controller = StreamController<VpnState>.broadcast();
  VpnState _current = const VpnState(status: VpnStatus.disconnected);

  @override
  VpnState get current => _current;

  @override
  Stream<VpnState> get states => _controller.stream;

  @override
  String mode = 'proxy';

  /// Преобразует [VpnProfile] в конфиг-ссылку, которую понимает движок.
  String _profileToLink(VpnProfile p) {
    switch (p.protocol) {
      case 'vless':
        final uuid = p.extra['uuid'] ?? '';
        return 'vless://$uuid@${p.address}:${p.port}?security=${p.extra['security']}#${p.name}';
      case 'trojan':
        final password = p.extra['password'] ?? '';
        return 'trojan://$password@${p.address}:${p.port}#${p.name}';
      default:
        return p.rawLink ?? '${p.protocol}://${p.address}:${p.port}';
    }
  }

  @override
  Future<void> start(VpnProfile profile, {String? mode}) async {
    if (mode != null) this.mode = mode;
    _emit(VpnState(status: VpnStatus.connecting, profileId: profile.id));
    try {
      final link = _profileToLink(profile);
      // Пример (уточните API плагина):
      // await FlutterV2rayPlus.startV2Ray(
      //   remark: profile.name,
      //   config: link,
      //   proxyOnly: mode == 'proxy',
      // );
      debugPrint('V2rayEngine.start: $link');
      _emit(VpnState(status: VpnStatus.connected, profileId: profile.id));
    } catch (e) {
      _emit(VpnState(status: VpnStatus.error, message: '$e'));
    }
  }

  @override
  Future<void> stop() async {
    // await FlutterV2rayPlus.stopV2Ray();
    _emit(const VpnState(status: VpnStatus.disconnected));
  }

  @override
  Future<int?> ping(VpnProfile profile) async {
    // Пример: await FlutterV2rayPlus.ping(...);
    return null;
  }

  void _emit(VpnState state) {
    _current = state;
    _controller.add(state);
  }

  @override
  Future<void> dispose() async => _controller.close();
}
