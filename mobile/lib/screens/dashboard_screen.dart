import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/l10n.dart';
import '../core/theme.dart';
import '../models/module_info.dart';
import '../services/module_manager.dart';
import '../widgets/neu_card.dart';
import '../widgets/pulse_dot.dart';
import '../widgets/stat_card.dart';

/// Главная панель: статус системы + быстрый доступ к модулям.
class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final modules = context.watch<ModuleManager>();
    final now = DateTime.now();
    final lastScan =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    final health = modules.totalCount == 0
        ? 100
        : ((modules.totalCount - _errors(modules)) / modules.totalCount * 100)
            .round();

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(18, 18, 18, 24),
        children: [
          // Заголовок
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  gradient: AppColors.brandGradient,
                ),
                alignment: Alignment.center,
                child: const Icon(Icons.hub_rounded,
                    color: Color(0xFF0A0E1A), size: 26),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      t.t('dashboard.title'),
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1,
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
                radius: 999,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const PulseDot(size: 7),
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
          ),

          const SizedBox(height: 20),

          // Статистика 2×2
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            childAspectRatio: 1.7,
            children: [
              StatCard(
                label: t.t('dashboard.modules').toUpperCase(),
                value: modules.totalCount.toString().padLeft(2, '0'),
                note: t.t('dashboard.running'),
                color: AppColors.primaryCyan,
              ),
              StatCard(
                label: 'ACTIVE',
                value: modules.runningCount.toString().padLeft(2, '0'),
                note: modules.runningCount > 0 ? t.t('dashboard.running') : '—',
                color: AppColors.primaryPurple,
                live: modules.runningCount > 0,
              ),
              StatCard(
                label: t.t('dashboard.health').toUpperCase(),
                value: '$health%',
                note: 'OK',
                color: AppColors.mint,
              ),
              StatCard(
                label: t.t('dashboard.lastScan').toUpperCase(),
                value: lastScan,
                note: 'NEXUS',
                color: AppColors.amber,
              ),
            ],
          ),

          const SizedBox(height: 20),

          // Пульс системы
          NeuCard(
            inset: true,
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
                    const PulseDot(size: 7),
                    const SizedBox(width: 6),
                    Text(
                      '${modules.runningCount}/${modules.totalCount}',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.mint,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                _PulseChart(value: modules.runningCount),
              ],
            ),
          ),

          const SizedBox(height: 22),

          // Быстрый доступ
          Text(
            t.t('dashboard.quick'),
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 12),
          ...modules.modules.map((m) => _QuickRow(module: m)),
        ],
      ),
    );
  }

  int _errors(ModuleManager modules) => 0;
}

class _QuickRow extends StatelessWidget {
  const _QuickRow({required this.module});

  final ModuleInfo module;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final modules = context.read<ModuleManager>();
    final running = module.isRunning;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: NeuCard(
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
      ),
    );
  }
}

class _PulseChart extends StatelessWidget {
  const _PulseChart({required this.value});

  final int value;

  @override
  Widget build(BuildContext context) {
    const bars = 24;
    return SizedBox(
      height: 56,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: List.generate(bars, (i) {
          final wave = (i + value * 4) % 7;
          final h = 8.0 + (wave * 6.0) + (i % 3) * 4;
          return Expanded(
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 2),
              height: h,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(3),
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    AppColors.primaryCyan.withOpacity( 0.9),
                    AppColors.primaryCyan.withOpacity( 0.2),
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
