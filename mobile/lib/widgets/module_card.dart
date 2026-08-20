import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../models/module_info.dart';
import 'neu_card.dart';
import 'neon_toggle.dart';
import 'pulse_dot.dart';

/// Карточка модуля с иконкой, статусом и тумблером.
class ModuleCard extends StatelessWidget {
  const ModuleCard({
    super.key,
    required this.module,
    required this.name,
    required this.description,
    required this.statusLabel,
    required this.actionLabel,
    required this.onToggle,
    this.onTap,
  });

  final ModuleInfo module;
  final String name;
  final String description;
  final String statusLabel;
  final String actionLabel;
  final VoidCallback onToggle;
  final VoidCallback? onTap;

  Color get _statusColor => switch (module.status) {
        ModuleStatus.running => AppColors.mint,
        ModuleStatus.starting => AppColors.amber,
        ModuleStatus.error => AppColors.red,
        ModuleStatus.stopped => AppColors.textMuted,
      };

  Color get _accent => switch (module.id) {
        ModuleId.dpi => AppColors.primaryCyan,
        ModuleId.tgProxy => AppColors.primaryPurple,
        ModuleId.vpn => AppColors.mint,
      };

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      onTap: onTap,
      radius: 22,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      _accent.withOpacity(0.28),
                      _accent.withOpacity(0.05),
                    ],
                  ),
                  border: Border.all(
                    color: _accent.withOpacity(0.35),
                    width: 1,
                  ),
                ),
                alignment: Alignment.center,
                child: Text(module.icon, style: const TextStyle(fontSize: 21)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Row(
                      children: [
                        PulseDot(
                          size: 7,
                          color: _statusColor,
                          pulse: module.isRunning,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            statusLabel,
                            style: TextStyle(fontSize: 11, color: _statusColor),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              NeonToggle(
                value: module.isRunning,
                onChanged: (_) => onToggle(),
              ),
            ],
          ),
          const SizedBox(height: 13),
          Text(
            description,
            style: const TextStyle(
              fontSize: 12,
              height: 1.45,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 13),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                module.extra,
                style: const TextStyle(
                  fontSize: 10,
                  color: AppColors.textMuted,
                  fontFamily: 'monospace',
                ),
              ),
              Text(
                actionLabel,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.primaryCyan,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
