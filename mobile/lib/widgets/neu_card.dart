import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Неоморфная карточка с двойными тенями (светлая сверху + тёмная снизу).
class NeuCard extends StatelessWidget {
  const NeuCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(18),
    this.depth = 6,
    this.radius = 20,
    this.color = AppColors.cardDark,
    this.onTap,
    this.inset = false,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double depth;
  final double radius;
  final Color color;
  final VoidCallback? onTap;
  final bool inset;

  @override
  Widget build(BuildContext context) {
    final decoration = inset
        ? Neu.inset(color: color, radius: radius, depth: depth)
        : Neu.card(color: color, depth: depth, radius: radius);

    final content = AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      padding: padding,
      decoration: decoration,
      child: child,
    );

    if (onTap == null) return content;

    return GestureDetector(
      onTap: onTap,
      child: content,
    );
  }
}
