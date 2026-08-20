import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';

import '../core/l10n.dart';
import '../core/theme.dart';
import '../models/module_info.dart';
import '../services/module_manager.dart';
import '../widgets/neu_card.dart';
import '../widgets/pulse_dot.dart';
import '../widgets/stat_card.dart';

/// Экран «Обзор»: состояние системы + быстрый доступ к модулям.
class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final modules = context.watch<ModuleManager>();
    final running = modules.runningCount;
    final total = modules.totalCount;
    final now = DateTime.now();
    final lastScan =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    final health = total == 0 ? 100 : 100;

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
                    t.t('dashboard.tagline'),
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            NeuCard(
              inset: true,
              radius: 999,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  PulseDot(size: 7, color: AppColors.mint),
                  const SizedBox(width: 6),
                  Text(
                    t.t('dashboard.live'),
                    style: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1,
                      color: AppColors.mint,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ).animate().fadeIn(duration: 350.ms).slideY(begin: -0.04, end: 0),

        const SizedBox(height: 18),

        // Статистика 2×2
        Row(
          children: [
            Expanded(
              child: StatCard(
                label: t.t('dashboard.modules'),
                value: total.toString().padLeft(2, '0'),
                icon: Icons.widgets_rounded,
                color: AppColors.primaryCyan,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: StatCard(
                label: 'ACTIVE',
                value: running.toString().padLeft(2, '0'),
                icon: Icons.bolt_rounded,
                color: AppColors.primaryPurple,
              ),
            ),
          ],
        ).animate().fadeIn(duration: 400.ms, delay: 60.ms),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: StatCard(
                label: t.t('dashboard.health'),
                value: '$health%',
                icon: Icons.favorite_rounded,
                color: AppColors.mint,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: StatCard(
                label: t.t('dashboard.lastScan'),
                value: lastScan,
                icon: Icons.history_rounded,
                color: AppColors.amber,
              ),
            ),
          ],
        ).animate().fadeIn(duration: 400.ms, delay: 120.ms),

        const SizedBox(height: 18),

        // Пульс системы
        NeuCard(
          radius: 20,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    t.t('dashboard.pulse'),
                    style: const TextStyle(
                      fontSize: 11,
                      letterSpacing: 1.4,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textMuted,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    '$running / $total',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.mint,
                      fontFamily: 'monospace',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              _PulseChart(active: running),
            ],
          ),
        ).animate().fadeIn(duration: 400.ms, delay: 180.ms),

        const SizedBox(height: 20),

        // Быстрый доступ
        Text(
          t.t('dashboard.quick'),
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ).animate().fadeIn(duration: 350.ms, delay: 220.ms),
        const SizedBox(height: 12),
        ...List.generate(modules.modules.length, (i) {
          final m = modules.modules[i];
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _QuickRow(module: m),
          ).animate().fadeIn(
                duration: 350.ms,
                delay: Duration(milliseconds: 260 + i * 60),
              ).slideY(begin: 0.06, end: 0);
        }),
      ],
    );
  }
}

class _QuickRow extends StatelessWidget {
  const _QuickRow({required this.module});

  final ModuleInfo module;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final modules = context.read<ModuleManager>();
    final running = module.isRunning;

    return NeuCard(
      radius: 18,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      onTap: () => modules.toggle(module.id),
      child: Row(
        children: [
          Text(module.icon, style: const TextStyle(fontSize: 22)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t.t(module.nameKey),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                Text(
                  t.t(module.descKey),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          PulseDot(
            size: 8,
            color: running ? AppColors.mint : AppColors.textMuted,
            pulse: running,
          ),
        ],
      ),
    );
  }
}

class _PulseChart extends StatelessWidget {
  const _PulseChart({required this.active});

  final int active;

  @override
  Widget build(BuildContext context) {
    const bars = 28;
    return SizedBox(
      height: 56,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: List.generate(bars, (i) {
          final wave = (i + active * 5) % 8;
          final h = 8.0 + wave * 5.0 + (i % 4) * 3;
          final lit = wave < 4;
          return Expanded(
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 2),
              height: h,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(3),
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: lit
                      ? [
                          AppColors.primaryCyan.withOpacity(0.9),
                          AppColors.primaryCyan.withOpacity(0.15),
                        ]
                      : [
                          AppColors.textMuted.withOpacity(0.5),
                          AppColors.textMuted.withOpacity(0.1),
                        ],
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}
