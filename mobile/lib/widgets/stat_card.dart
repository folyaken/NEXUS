import 'package:flutter/material.dart';

import '../core/theme.dart';
import 'neu_card.dart';

/// Компактная карточка-статистика.
class StatCard extends StatelessWidget {
  const StatCard({
    super.key,
    required this.label,
    required this.value,
    this.icon,
    this.color = AppColors.primaryCyan,
  });

  final String label;
  final String value;
  final IconData? icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      radius: 16,
      child: Row(
        children: [
          if (icon != null) ...[
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(11),
                gradient: LinearGradient(
                  colors: [
                    color.withOpacity(0.24),
                    color.withOpacity(0.06),
                  ],
                ),
                border: Border.all(color: color.withOpacity(0.3), width: 1),
              ),
              child: Icon(icon, size: 17, color: color),
            ),
            const SizedBox(width: 10),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label.toUpperCase(),
                  style: const TextStyle(
                    fontSize: 9,
                    letterSpacing: 1.1,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textMuted,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
