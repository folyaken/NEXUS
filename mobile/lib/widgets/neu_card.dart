import 'dart:ui';

import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Стеклянная карточка: frosted-glass с мягкой тенью и тонкой обводкой.
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
  final bool gradient;

  @override
  Widget build(BuildContext context) {
    final borderRadius = BorderRadius.circular(radius);

    final Widget card = ClipRRect(
      borderRadius: borderRadius,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            borderRadius: borderRadius,
            color: inset
                ? AppColors.backgroundDark
                : AppColors.cardDark.withOpacity(0.72),
            gradient: !inset
                ? LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Colors.white.withOpacity(gradient ? 0.12 : 0.06),
                      Colors.white.withOpacity(0.0),
                    ],
                  )
                : null,
            border: Border.all(
              color: gradient
                  ? AppColors.primaryCyan.withOpacity(0.35)
                  : Colors.white.withOpacity(0.07),
            ),
            boxShadow: inset
                ? null
                : [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.45),
                      offset: const Offset(0, 10),
                      blurRadius: 30,
                    ),
                  ],
          ),
          child: child,
        ),
      ),
    );

    if (onTap == null) return card;

    return GestureDetector(
      onTap: onTap,
      child: card,
    );
  }
}
