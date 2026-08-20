import 'package:flutter/material.dart';

import '../core/theme.dart';
import 'neu_card.dart';
import 'pulse_dot.dart';

/// Маленькая карточка-статистика (как на десктопном дашборде).
class StatCard extends StatelessWidget {
  const StatCard({
    super.key,
    required this.label,
    required this.value,
    this.note,
    this.color = AppColors.primaryCyan,
    this.live = false,
  });

  final String label;
  final String value;
  final String? note;
  final Color color;
  final bool live;

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      padding: const EdgeInsets.all(14),
      radius: 16,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: color,
                  boxShadow: [
                    BoxShadow(
                      color: color.withOpacity(alpha: 0.6),
                      blurRadius: 6,
                    ),
                  ],
                ),
              ),
              if (live) ...[
                const SizedBox(width: 6),
                const PulseDot(size: 7),
              ],
              const Spacer(),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 9,
                  letterSpacing: 1.1,
                  color: AppColors.textMuted,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          Text(
            value,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          if (note != null)
            Text(
              note!,
              style: const TextStyle(
                fontSize: 11,
                color: AppColors.textSecondary,
              ),
            ),
        ],
      ),
    );
  }
}
