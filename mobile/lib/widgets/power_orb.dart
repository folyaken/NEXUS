import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Круглая кнопка питания VPN (как орбита в десктопном Jey2Ray).
class PowerOrb extends StatelessWidget {
  const PowerOrb({
    super.key,
    required this.connected,
    required this.onTap,
    this.size = 148,
  });

  final bool connected;
  final VoidCallback onTap;
  final double size;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 260),
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: connected
                ? [
                    AppColors.primaryCyan.withOpacity( 0.28),
                    AppColors.cardDark,
                  ]
                : [
                    AppColors.cardLight,
                    AppColors.cardDark,
                  ],
            stops: const [0.0, 1.0],
          ),
          boxShadow: connected
              ? [
                  BoxShadow(
                    color: AppColors.primaryCyan.withOpacity( 0.45),
                    blurRadius: 34,
                    spreadRadius: 4,
                  ),
                  ...Neu.shadows(depth: 6, radius: 20),
                ]
              : Neu.shadows(depth: 6, radius: 20),
          border: Border.all(
            color: connected
                ? AppColors.primaryCyan.withOpacity( 0.5)
                : Colors.white.withOpacity( 0.06),
          ),
        ),
        alignment: Alignment.center,
        child: Icon(
          Icons.power_settings_new_rounded,
          size: size * 0.42,
          color: connected ? AppColors.primaryCyan : AppColors.textMuted,
        ),
      ),
    );
  }
}
