import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/l10n.dart';
import '../core/logger.dart';
import '../core/theme.dart';
import '../models/vpn_profile.dart';
import '../services/profile_parser.dart';
import '../services/storage_service.dart';
import '../services/subscription_manager.dart';
import '../services/vpn_engine.dart';
import '../widgets/neu_card.dart';
import '../widgets/power_orb.dart';
import '../widgets/pulse_dot.dart';
import 'qr_scan_screen.dart';
import 'subscriptions_screen.dart';

/// Экран Jey2Ray: выбор сервера, подключение, режимы, импорт профилей.
class Jey2RayScreen extends StatefulWidget {
  const Jey2RayScreen({super.key});

  @override
  State<Jey2RayScreen> createState() => _Jey2RayScreenState();
}

class _Jey2RayScreenState extends State<Jey2RayScreen> {
  final List<VpnProfile> _manual = [];
  final Map<String, int> _ping = {};
  StreamSubscription<VpnState>? _sub;
  VpnStatus _status = VpnStatus.disconnected;
  String? _selectedId;
  String _mode = 'proxy';

  @override
  void initState() {
    super.initState();
    _loadManual();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final engine = context.read<VpnEngine>();
      _status = engine.current.status;
      _mode = engine.mode;
      _sub = engine.states.listen((state) {
        if (!mounted) return;
        setState(() => _status = state.status);
      });
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _loadManual() async {
    final storage = context.read<StorageService>();
    final list = await storage.loadManualProfiles();
    if (!mounted) return;
    setState(() => _manual..clear()..addAll(list));
  }

  List<VpnProfile> get _allProfiles {
    final subs = context.read<SubscriptionManager>().subscriptions;
    final fromSubs = subs.expand((s) => s.profiles).toList();
    return [..._manual, ...fromSubs];
  }

  Future<void> _connect(VpnProfile profile) async {
    final engine = context.read<VpnEngine>();
    setState(() => _selectedId = profile.id);
    if (_status == VpnStatus.connected) {
      await engine.stop();
      AppLogger.instance.info('vpn', 'VPN отключён');
      return;
    }
    AppLogger.instance.info('vpn', 'Подключение к ${profile.name}');
    await engine.start(profile, mode: _mode);
  }

  Future<void> _pingAll() async {
    final engine = context.read<VpnEngine>();
    for (final p in _allProfiles) {
      final ms = await engine.ping(p);
      if (!mounted) return;
      setState(() => _ping[p.id] = ms ?? 999);
    }
  }

  Future<void> _addByLink() async {
    final t = AppLocalizations.of(context);
    final controller = TextEditingController();
    final link = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.cardDark,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(t.t('vpn.import'), style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autofocus: true,
              decoration: InputDecoration(
                hintText: 'vless://… vmess://… ss://…',
                filled: true,
                fillColor: AppColors.backgroundDark,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextButton.icon(
                    onPressed: () => Navigator.pop(ctx, controller.text.trim()),
                    icon: const Icon(Icons.check),
                    label: Text(t.t('common.add')),
                  ),
                ),
                TextButton.icon(
                  onPressed: () async {
                    Navigator.pop(ctx);
                    final scanned = await Navigator.push<String>(
                      context,
                      MaterialPageRoute(builder: (_) => const QrScanScreen()),
                    );
                    if (scanned != null) await _importLink(scanned);
                  },
                  icon: const Icon(Icons.qr_code_scanner),
                  label: Text(t.t('vpn.qr')),
                ),
              ],
            ),
          ],
        ),
      ),
    );

    if (link != null && link.isNotEmpty) await _importLink(link);
  }

  Future<void> _importLink(String link) async {
    final t = AppLocalizations.of(context);
    try {
      final profile = ProfileParser.parse(link);
      await context.read<StorageService>().saveProfile(profile);
      await _loadManual();
      AppLogger.instance.success('vpn', 'Профиль добавлен: ${profile.name}');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${t.t('common.error')}: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    context.watch<SubscriptionManager>(); // обновлять список при изменении подписок
    final profiles = _allProfiles;
    final connected = _status == VpnStatus.connected;
    final connecting = _status == VpnStatus.connecting;

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 24),
        children: [
          Row(
            children: [
              Text(
                t.t('vpn.title'),
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              const Spacer(),
              IconButton(
                onPressed: _addByLink,
                icon: const Icon(Icons.add, color: AppColors.primaryCyan),
              ),
              IconButton(
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const SubscriptionsScreen()),
                ),
                icon: const Icon(Icons.rss_feed, color: AppColors.primaryPurple),
              ),
            ],
          ),

          const SizedBox(height: 8),

          // Орбита питания
          Center(
            child: Column(
              children: [
                PowerOrb(
                  connected: connected,
                  onTap: () {
                    final selected = _selectedProfile(profiles);
                    if (selected != null) _connect(selected);
                  },
                ),
                const SizedBox(height: 14),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 200),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      PulseDot(
                        size: 7,
                        color: connected
                            ? AppColors.mint
                            : connecting
                                ? AppColors.amber
                                : AppColors.textMuted,
                        pulse: connected || connecting,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        connecting
                            ? t.t('vpn.connecting')
                            : connected
                                ? '${t.t('vpn.connected')} · ${_ping[_selectedId] ?? '—'} мс'
                                : t.t('vpn.disconnected'),
                        key: ValueKey('$_status'),
                        style: TextStyle(
                          color: connected
                              ? AppColors.mint
                              : connecting
                                  ? AppColors.amber
                                  : AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 18),

          // Переключатель режима
          Center(
            child: NeuCard(
              inset: true,
              radius: 999,
              padding: const EdgeInsets.all(4),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: ['proxy', 'tun'].map((mode) {
                  final active = _mode == mode;
                  return GestureDetector(
                    onTap: () {
                      setState(() => _mode = mode);
                      context.read<VpnEngine>().mode = mode;
                    },
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 26,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(999),
                        gradient: active ? AppColors.brandGradient : null,
                      ),
                      child: Text(
                        mode.toUpperCase(),
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 12,
                          letterSpacing: 1,
                          color: active
                              ? const Color(0xFF0A0E1A)
                              : AppColors.textMuted,
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
          ),

          const SizedBox(height: 18),

          Row(
            children: [
              Text(
                '${t.t('vpn.subs')} · ${profiles.length}',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: _pingAll,
                icon: const Icon(Icons.speed, size: 18),
                label: Text(t.t('vpn.ping')),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primaryCyan,
                ),
              ),
            ],
          ),

          if (profiles.isEmpty)
            NeuCard(
              child: Column(
                children: [
                  const Icon(Icons.cloud_off, color: AppColors.textMuted),
                  const SizedBox(height: 8),
                  Text(
                    t.t('vpn.noProfiles'),
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    t.t('vpn.noProfilesHint'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            )
          else
            ...profiles.map((p) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _ServerRow(
                    profile: p,
                    selected: _selectedId == p.id,
                    ping: _ping[p.id],
                    onTap: () => _connect(p),
                  ),
                )),
        ],
      ),
    );
  }

  VpnProfile? _selectedProfile(List<VpnProfile> profiles) {
    if (profiles.isEmpty) return null;
    if (_selectedId != null) {
      for (final p in profiles) {
        if (p.id == _selectedId) return p;
      }
    }
    return profiles.first;
  }
}

class _ServerRow extends StatelessWidget {
  const _ServerRow({
    required this.profile,
    required this.selected,
    required this.ping,
    required this.onTap,
  });

  final VpnProfile profile;
  final bool selected;
  final int? ping;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ms = ping;
    final pingColor = ms == null
        ? AppColors.textMuted
        : ms < 80
            ? AppColors.mint
            : ms < 150
                ? AppColors.amber
                : AppColors.red;

    return NeuCard(
      radius: 16,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      onTap: onTap,
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              gradient: selected ? AppColors.brandGradient : null,
              color: selected ? null : AppColors.cardLight,
            ),
            alignment: Alignment.center,
            child: Text(
              profile.upperProtocol,
              style: TextStyle(
                fontSize: 9,
                fontWeight: FontWeight.w800,
                color: selected ? const Color(0xFF0A0E1A) : AppColors.primaryCyan,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  profile.name,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                Text(
                  profile.displayAddress,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.textSecondary,
                    fontFamily: 'monospace',
                  ),
                ),
              ],
            ),
          ),
          Text(
            ms == null ? '—' : '$ms мс',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: pingColor,
              fontFamily: 'monospace',
            ),
          ),
          const SizedBox(width: 6),
          Icon(Icons.chevron_right, color: AppColors.textMuted, size: 20),
        ],
      ),
    );
  }
}
