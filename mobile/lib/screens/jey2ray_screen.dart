import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';

import '../core/l10n.dart';
import '../core/logger.dart';
import '../core/theme.dart';
import '../models/vpn_profile.dart';
import '../services/profile_parser.dart';
import '../services/storage_service.dart';
import '../services/subscription_manager.dart';
import '../services/vpn_engine.dart';
import '../widgets/flag.dart';
import '../widgets/neu_card.dart';
import '../widgets/power_orb.dart';
import '../widgets/pulse_dot.dart';
import '../widgets/stat_card.dart';
import 'add_subscription_screen.dart';
import 'qr_scan_screen.dart';

/// Экран Jey2Ray — VPN-клиент.
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
        if (mounted) setState(() => _status = state.status);
      });
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _loadManual() async {
    final list = await context.read<StorageService>().loadManualProfiles();
    if (!mounted) return;
    setState(() => _manual..clear()..addAll(list));
  }

  List<VpnProfile> get _profiles {
    final subs = context.read<SubscriptionManager>().subscriptions;
    return [..._manual, ...subs.expand((s) => s.profiles).toList()];
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
    for (final p in _profiles) {
      final ms = await engine.ping(p);
      if (!mounted) return;
      setState(() => _ping[p.id] = ms ?? 999);
    }
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

  Future<void> _showAddSheet() async {
    final t = AppLocalizations.of(context);
    final controller = TextEditingController();
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        padding: EdgeInsets.only(
          left: 18,
          right: 18,
          top: 18,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 18,
        ),
        decoration: const BoxDecoration(
          color: AppColors.cardDark,
          borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.textMuted,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              t.t('vpn.import'),
              style: const TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: controller,
              autofocus: true,
              decoration: InputDecoration(
                hintText: 'vless://… vmess://… ss://…',
                filled: true,
                fillColor: AppColors.backgroundDark,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _gradientButton(
                    label: t.t('common.add'),
                    onPressed: () {
                      Navigator.pop(ctx);
                      final link = controller.text.trim();
                      if (link.isNotEmpty) _importLink(link);
                    },
                  ),
                ),
                const SizedBox(width: 10),
                _outlineIconButton(
                  icon: Icons.qr_code_scanner_rounded,
                  onPressed: () async {
                    Navigator.pop(ctx);
                    final scanned = await Navigator.push<String>(
                      context,
                      MaterialPageRoute(builder: (_) => const QrScanScreen()),
                    );
                    if (scanned != null) await _importLink(scanned);
                  },
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    context.watch<SubscriptionManager>();
    final profiles = _profiles;
    final connected = _status == VpnStatus.connected;
    final connecting = _status == VpnStatus.connecting;
    final selected = _selectedProfile(profiles);
    final selectedPing = _selectedId != null ? _ping[_selectedId] : null;

    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 24),
      children: [
        // Шапка
        Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(13),
                gradient: AppColors.brandGradient,
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primaryCyan.withOpacity(0.35),
                    blurRadius: 16,
                  ),
                ],
              ),
              child: const Icon(
                Icons.hub_rounded,
                color: AppColors.backgroundDark,
                size: 24,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    t.t('dashboard.title'),
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.5,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  Text(
                    t.t('vpn.title'),
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            _statusPill(t, connected, connecting, selectedPing),
          ],
        ).animate().fadeIn(duration: 350.ms).slideY(begin: -0.04, end: 0),

        const SizedBox(height: 18),

        // Орбита питания
        Center(
          child: PowerOrb(
            connected: connected,
            onTap: selected == null ? null : () => _connect(selected!),
          ),
        ).animate().fadeIn(duration: 450.ms),

        const SizedBox(height: 16),

        // Режим PROXY / TUN
        Center(
          child: _modeSwitch(context),
        ).animate().fadeIn(duration: 400.ms, delay: 100.ms),

        const SizedBox(height: 16),

        // Статистика
        Row(
          children: [
            Expanded(
              child: StatCard(
                label: 'Пинг',
                value: selectedPing != null ? '$selectedPing мс' : '—',
                icon: Icons.speed_rounded,
                color: AppColors.mint,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: StatCard(
                label: 'Протокол',
                value: selected?.upperProtocol ?? '—',
                icon: Icons.vpn_lock_rounded,
                color: AppColors.primaryCyan,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: StatCard(
                label: t.t('vpn.subs'),
                value: '${profiles.length}',
                icon: Icons.public_rounded,
                color: AppColors.primaryPurple,
              ),
            ),
          ],
        ).animate().fadeIn(duration: 400.ms, delay: 160.ms),

        const SizedBox(height: 22),

        // Заголовок серверов + действия
        Row(
          children: [
            Expanded(
              child: Text(
                '${t.t('vpn.servers')} · ${profiles.length}',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            IconButton(
              onPressed: _pingAll,
              icon: const Icon(Icons.speed_rounded,
                  size: 20, color: AppColors.primaryCyan),
            ),
            IconButton(
              onPressed: _showAddSheet,
              icon: const Icon(Icons.add_circle_rounded,
                  size: 22, color: AppColors.primaryPurple),
            ),
          ],
        ).animate().fadeIn(duration: 400.ms, delay: 220.ms),

        if (profiles.isEmpty)
          _emptyState(t).animate().fadeIn(duration: 400.ms)
        else
          ...List.generate(profiles.length, (i) {
            final p = profiles[i];
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _ServerRow(
                profile: p,
                selected: _selectedId == p.id,
                live: connected && _selectedId == p.id,
                ping: _ping[p.id],
                onTap: () => _connect(p),
              ),
            ).animate().fadeIn(
                  duration: 350.ms,
                  delay: Duration(milliseconds: 260 + i * 60),
                ).slideY(begin: 0.08, end: 0);
          }),
      ],
    );
  }

  /// Статус-индикатор: зелёный кружок (подключено) / красный (отключено).
  Widget _statusPill(
      AppLocalizations t, bool connected, bool connecting, int? ping) {
    final color = connected
        ? AppColors.mint
        : connecting
            ? AppColors.amber
            : AppColors.red;
    final label = connecting
        ? t.t('vpn.connecting')
        : connected
            ? '${t.t('vpn.connected')}${ping != null ? ' · $ping мс' : ''}'
            : t.t('vpn.disconnected');

    return NeuCard(
      inset: true,
      radius: 999,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          PulseDot(size: 8, color: color, pulse: connected || connecting),
          const SizedBox(width: 8),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _emptyState(AppLocalizations t) {
    return NeuCard(
      radius: 20,
      child: Column(
        children: [
          GestureDetector(
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const AddSubscriptionScreen()),
            ),
            child: Container(
              width: 62,
              height: 62,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: AppColors.brandGradient,
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primaryCyan.withOpacity(0.45),
                    blurRadius: 22,
                  ),
                ],
              ),
              child: const Icon(
                Icons.add_rounded,
                size: 32,
                color: AppColors.backgroundDark,
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            t.t('vpn.empty'),
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            t.t('vpn.empty.hint'),
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 12,
              height: 1.4,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _modeSwitch(BuildContext context) {
    final t = AppLocalizations.of(context);
    return NeuCard(
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
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOutCubic,
              padding:
                  const EdgeInsets.symmetric(horizontal: 30, vertical: 10),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(999),
                gradient: active ? AppColors.brandGradient : null,
                boxShadow: active
                    ? [
                        BoxShadow(
                          color: AppColors.primaryCyan.withOpacity(0.4),
                          blurRadius: 14,
                        ),
                      ]
                    : null,
              ),
              child: Text(
                mode == 'proxy' ? t.t('vpn.mode.proxy') : t.t('vpn.mode.tun'),
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 12,
                  letterSpacing: 1,
                  color: active
                      ? AppColors.backgroundDark
                      : AppColors.textMuted,
                ),
              ),
            ),
          );
        }).toList(),
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

  Widget _gradientButton(
      {required String label, required VoidCallback onPressed}) {
    return SizedBox(
      height: 50,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          gradient: AppColors.brandGradient,
        ),
        child: TextButton(
          onPressed: onPressed,
          child: Text(
            label,
            style: const TextStyle(
              color: AppColors.backgroundDark,
              fontWeight: FontWeight.w800,
              fontSize: 15,
            ),
          ),
        ),
      ),
    );
  }

  Widget _outlineIconButton(
      {required IconData icon, required VoidCallback onPressed}) {
    return GestureDetector(
      onTap: onPressed,
      child: Container(
        width: 50,
        height: 50,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.primaryPurple.withOpacity(0.5)),
          color: AppColors.primaryPurple.withOpacity(0.1),
        ),
        child: Icon(icon, color: AppColors.primaryPurple),
      ),
    );
  }
}

class _ServerRow extends StatelessWidget {
  const _ServerRow({
    required this.profile,
    required this.selected,
    required this.live,
    required this.ping,
    required this.onTap,
  });

  final VpnProfile profile;
  final bool selected;
  final bool live;
  final int? ping;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = AppColors.protocolColor(profile.protocol);

    return NeuCard(
      radius: 18,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      onTap: onTap,
      gradient: selected,
      child: Row(
        children: [
          // Флаг
          Flag(country: profile.country),
          const SizedBox(width: 12),
          // Название + протокол
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        profile.name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                    if (live) ...[
                      const SizedBox(width: 6),
                      const PulseDot(size: 6, color: AppColors.mint),
                    ],
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  profile.upperProtocol,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.4,
                    color: color,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          // Пинг
          _pingMeter(ping),
          const SizedBox(width: 10),
          Icon(Icons.chevron_right_rounded,
              color: AppColors.textMuted, size: 22),
        ],
      ),
    );
  }

  Widget _pingMeter(int? ms) {
    if (ms == null) {
      return const Text('—',
          style: TextStyle(color: AppColors.textMuted, fontSize: 12));
    }
    final int bars = ms < 60 ? 3 : ms < 120 ? 2 : 1;
    final color = ms < 60
        ? AppColors.mint
        : ms < 120
            ? AppColors.amber
            : AppColors.red;
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (int i = 0; i < 3; i++)
          Container(
            width: 3,
            height: 6.0 + i * 4,
            margin: const EdgeInsets.only(left: 2),
            decoration: BoxDecoration(
              color: i < bars ? color : AppColors.textMuted.withOpacity(0.3),
              borderRadius: BorderRadius.circular(1.5),
            ),
          ),
        const SizedBox(width: 4),
        Text(
          '$ms',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: color,
            fontFamily: 'monospace',
          ),
        ),
      ],
    );
  }
}
