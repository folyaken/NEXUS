import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Флаг страны (эмодзи) в аккуратной плитке. Без кода — глобус.
class Flag extends StatelessWidget {
  const Flag({super.key, this.country, this.size = 40});

  final String? country;
  final double size;

  /// Двухбуквенный код → эмодзи-флаг (региональные индикаторы).
  static String emoji(String code) {
    final upper = code.toUpperCase();
    if (upper.length != 2) return '🌐';
    final a = 0x1F1E6 + (upper.codeUnitAt(0) - 0x41);
    final b = 0x1F1E6 + (upper.codeUnitAt(1) - 0x41);
    return String.fromCharCodes([a, b]);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.3),
        color: AppColors.cardLight.withOpacity(0.6),
        border: Border.all(color: Colors.white.withOpacity(0.06)),
      ),
      alignment: Alignment.center,
      child: Text(
        country == null ? '🌐' : emoji(country!),
        style: TextStyle(fontSize: size * 0.52),
      ),
    );
  }
}
