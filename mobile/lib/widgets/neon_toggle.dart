import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Неоновый тумблер с неоморфной дорожкой и плавной анимацией.
class NeonToggle extends StatelessWidget {
  const NeonToggle({
    super.key,
    required this.value,
    required this.onChanged,
    this.size = 52,
    this.busy = false,
  });

  final bool value;
  final ValueChanged<bool> onChanged;
  final double size;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final double height = size * 0.5;
    final double width = size;
    final double knob = height * 0.72;

    return GestureDetector(
      onTap: busy ? null : () => onChanged(!value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOutCubic,
        width: width,
        height: height,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(height / 2),
          gradient: value
              ? AppColors.brandGradient
              : const LinearGradient(
                  colors: [AppColors.cardLight, AppColors.cardDark],
                ),
          boxShadow: [
            BoxShadow(
              color: value
                  ? AppColors.primaryCyan.withOpacity(alpha: 0.45)
                  : AppColors.shadowDark,
              blurRadius: value ? 14 : 6,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Stack(
          children: [
            AnimatedAlign(
              duration: const Duration(milliseconds: 220),
              curve: Curves.easeOutCubic,
              alignment:
                  value ? Alignment.centerRight : Alignment.centerLeft,
              child: Container(
                margin: const EdgeInsets.symmetric(horizontal: 5),
                width: knob,
                height: knob,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white,
                  boxShadow: [
                    BoxShadow(color: Colors.black26, blurRadius: 4),
                  ],
                ),
              ),
            ),
            if (busy)
              const Center(
                child: SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
