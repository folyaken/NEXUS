import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Неоморфная карточка: двойные тени (тёмная снизу + светлая сверху),
/// лёгкий градиент и тонкая обводка.
class NeuCard extends StatelessWidget {
  const NeuCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.radius = 20,
    this.onTap,
    this.inset = false,
    this.gradient = false,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final VoidCallback? onTap;
  final bool inset;

  /// Подсвечивает обводку акцентным цветом (для выбранного элемента).
  final bool gradient;

  @override
  Widget build(BuildContext context) {
    final borderRadius = BorderRadius.circular(radius);

    final Widget card = Container(
      padding: padding,
      decoration: inset
          ? Neu.inset(radius: radius)
          : BoxDecoration(
              borderRadius: borderRadius,
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [AppColors.cardDark, AppColors.backgroundLight],
              ),
              border: Border.all(
                color: gradient
                    ? AppColors.primaryCyan.withOpacity(0.45)
                    : Colors.white.withOpacity(0.06),
                width: gradient ? 1.2 : 1,
              ),
              boxShadow: gradient
                  ? [
                      ...Neu.shadows(),
                      BoxShadow(
                        color: AppColors.primaryCyan.withOpacity(0.25),
                        blurRadius: 18,
                        spreadRadius: 0,
                      ),
                    ]
                  : Neu.shadows(),
            ),
      child: child,
    );

    if (onTap == null) return card;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: card,
    );
  }
}
