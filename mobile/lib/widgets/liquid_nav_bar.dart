import 'package:flutter/material.dart';

import '../core/theme.dart';
import 'neu_card.dart';

/// Элемент нижней навигации.
class LiquidNavItem {
  const LiquidNavItem({
    required this.icon,
    required this.label,
    this.accent = AppColors.primaryCyan,
  });

  final IconData icon;
  final String label;
  final Color accent;
}

/// Нижняя навигация с плавающей «каплей» над активной иконкой.
///
/// - активная иконка цветная + слегка увеличена;
/// - неактивные — серые и полупрозрачные;
/// - «капля» плавно перемещается к новой иконке и «падает» сверху (280 мс).
class LiquidNavBar extends StatelessWidget {
  const LiquidNavBar({
    super.key,
    required this.index,
    required this.items,
    required this.onChanged,
  });

  final int index;
  final List<LiquidNavItem> items;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return NeuCard(
      radius: 28,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final itemWidth = constraints.maxWidth / items.length;
          const dotWidth = 30.0;

          return SizedBox(
            height: 50,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                AnimatedPositioned(
                  duration: const Duration(milliseconds: 280),
                  curve: Curves.easeOutCubic,
                  left: index * itemWidth + (itemWidth - dotWidth) / 2,
                  top: -5,
                  child: _DropDot(
                    key: ValueKey(index),
                    accent: items[index].accent,
                  ),
                ),
                Row(
                  children: List.generate(items.length, (i) {
                    final item = items[i];
                    return Expanded(
                      child: _NavItem(
                        item: item,
                        selected: i == index,
                        onTap: () => onChanged(i),
                      ),
                    );
                  }),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// «Капля» над активной иконкой: появляется сверху вниз при переключении.
class _DropDot extends StatelessWidget {
  const _DropDot({super.key, required this.accent});

  final Color accent;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOutCubic,
      builder: (context, t, child) => Transform.translate(
        offset: Offset(0, (1 - t) * -12),
        child: Opacity(opacity: t, child: child),
      ),
      child: Container(
        width: 30,
        height: 5,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          gradient: LinearGradient(
            colors: [accent, accent.withOpacity(0.45)],
          ),
          boxShadow: [
            BoxShadow(
              color: accent.withOpacity(0.7),
              blurRadius: 12,
              spreadRadius: 1,
            ),
          ],
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.item,
    required this.selected,
    required this.onTap,
  });

  final LiquidNavItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AnimatedScale(
            scale: selected ? 1.16 : 1.0,
            duration: const Duration(milliseconds: 260),
            curve: Curves.easeOutBack,
            child: AnimatedOpacity(
              opacity: selected ? 1.0 : 0.45,
              duration: const Duration(milliseconds: 240),
              child: TweenAnimationBuilder<double>(
                tween: Tween(end: selected ? 1.0 : 0.0),
                duration: const Duration(milliseconds: 240),
                curve: Curves.easeOutCubic,
                builder: (context, v, _) => Icon(
                  item.icon,
                  size: 22,
                  color: Color.lerp(AppColors.textMuted, item.accent, v),
                ),
              ),
            ),
          ),
          const SizedBox(height: 3),
          Text(
            item.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 9,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              color: selected ? item.accent : AppColors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}
