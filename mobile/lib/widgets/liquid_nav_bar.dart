import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Элемент нижней навигации.
class LiquidNavItem {
  const LiquidNavItem({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;
}

/// «Жидкая» нижняя навигация (liquid / gooey effect).
///
/// Над активной иконкой — круглый пузырь (#6C63FF) с белой иконкой внутри.
/// При переключении:
///  1) пузырь сплющивается по горизонтали (scaleX 1 → 0.55);
///  2) плавно скользит к новой иконке;
///  3) снова становится кругом;
///  4) иконка меняется (старая «тонет», новая «всплывает»);
///  5) пузырь слегка «продавливает» панель (ямка + дип).
class LiquidNavBar extends StatefulWidget {
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
  State<LiquidNavBar> createState() => _LiquidNavBarState();
}

class _LiquidNavBarState extends State<LiquidNavBar>
    with SingleTickerProviderStateMixin {
  static const double _bubble = 46; // размер пузыря
  static const double _iconCenterY = 26; // вертикальный центр иконок
  static const double _barHeight = 68;

  static const Color _bubbleColor = Color(0xFF6C63FF);

  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 380),
  );

  late int _currentIndex = widget.index;
  int _fromIndex = 0;
  bool _animating = false;

  @override
  void didUpdateWidget(LiquidNavBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.index != widget.index) {
      if (widget.index != _currentIndex) {
        _start(widget.index);
      } else if (!_animating) {
        setState(() => _currentIndex = widget.index);
      }
    }
  }

  void _onTap(int i) {
    if (i == _currentIndex) return;
    widget.onChanged(i);
    _start(i);
  }

  void _start(int to) {
    setState(() {
      _fromIndex = _currentIndex;
      _currentIndex = to;
      _animating = true;
    });
    _controller.forward(from: 0).whenComplete(() {
      if (mounted) setState(() => _animating = false);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  // ---- фазы ----

  /// 1 → 0.55 (0..0.22), держится (0.22..0.78), 0.55 → 1 (0.78..1).
  double _squash(double t) {
    if (t < 0.22) return 1.0 - 0.45 * (t / 0.22);
    if (t < 0.78) return 0.55;
    return 0.55 + 0.45 * ((t - 0.78) / 0.22);
  }

  /// Скольжение по горизонтали (0.25..0.75).
  double _move(double t) {
    if (t <= 0.25) return 0.0;
    if (t >= 0.75) return 1.0;
    return Curves.easeInOutCubic.transform((t - 0.25) / 0.5);
  }

  /// «Продавливание»: дип в моменты сжатия/расширения.
  double _press(double t) {
    final a = math.exp(-math.pow((t - 0.24) / 0.06, 2).toDouble());
    final b = math.exp(-math.pow((t - 0.76) / 0.06, 2).toDouble());
    return 5.0 * (a + b);
  }

  /// Кроссфейд иконки внутри пузыря.
  double _fade(double t) => ((t - 0.45) / 0.12).clamp(0.0, 1.0);

  /// Прозрачность иконки в ряду (0 = она «в пузыре»).
  double _rowIconOpacity(int i) {
    if (!_animating) return i == _currentIndex ? 0.0 : 1.0;
    final t = _controller.value;
    if (i == _fromIndex) return (t / 0.22).clamp(0.0, 1.0);
    if (i == _currentIndex) {
      return (1.0 - (t - 0.78) / 0.22).clamp(0.0, 1.0);
    }
    return 1.0;
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.items;

    return Container(
      height: _barHeight,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(26),
        color: AppColors.navBackground.withOpacity(0.92),
        border: Border.all(color: Colors.white.withOpacity(0.06)),
        boxShadow: Neu.shadows(depth: 16, radius: 32),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final itemWidth = constraints.maxWidth / items.length;

          return AnimatedBuilder(
            animation: _controller,
            builder: (context, _) {
              final t = _controller.value;
              final fromX = _fromIndex * itemWidth + itemWidth / 2;
              final toX = _currentIndex * itemWidth + itemWidth / 2;
              final x = fromX + (toX - fromX) * _move(t);
              final sx = _animating ? _squash(t) : 1.0;
              final press = _animating ? _press(t) : 0.0;
              final bubbleTop = _iconCenterY - _bubble / 2 + press;

              return Stack(
                clipBehavior: Clip.none,
                children: [
                  // «Ямка» под пузырём — тёмное пятно, продавленное в панели.
                  Positioned(
                    left: x - 26,
                    top: _iconCenterY + _bubble / 2 - 4 + press,
                    child: Opacity(
                      opacity: ((_press(t)) / 5).clamp(0.0, 1.0) * 0.9,
                      child: Container(
                        width: 52,
                        height: 10,
                        decoration: BoxDecoration(
                          gradient: RadialGradient(
                            colors: [
                              Colors.black.withOpacity(0.55),
                              Colors.transparent,
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                  // Ряд иконок
                  Row(
                    children: List.generate(items.length, (i) {
                      return Expanded(
                        child: _NavItemView(
                          item: items[i],
                          iconOpacity: _rowIconOpacity(i),
                          selected: i == _currentIndex,
                          onTap: () => _onTap(i),
                        ),
                      );
                    }),
                  ),
                  // Пузырь
                  Positioned(
                    left: x - _bubble / 2,
                    top: bubbleTop,
                    child: Transform.scale(
                      scaleX: sx,
                      scaleY: 1.0 + (1.0 - sx) * 0.45,
                      child: _Bubble(icon: _bubbleIcon(items)),
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }

  Widget _bubbleIcon(List<LiquidNavItem> items) {
    const white = Colors.white;
    if (!_animating) {
      return Icon(items[_currentIndex].icon, color: white, size: 20);
    }
    final fade = _fade(_controller.value);
    final oldIcon = items[_fromIndex].icon;
    final newIcon = items[_currentIndex].icon;
    return SizedBox(
      width: 22,
      height: 22,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Opacity(
            opacity: (1 - fade).clamp(0.0, 1.0),
            child: Transform.translate(
              offset: Offset(0, fade * 16),
              child: Icon(oldIcon, color: white, size: 20),
            ),
          ),
          Opacity(
            opacity: fade.clamp(0.0, 1.0),
            child: Transform.translate(
              offset: Offset(0, -(1 - fade) * 16),
              child: Icon(newIcon, color: white, size: 20),
            ),
          ),
        ],
      ),
    );
  }
}

/// Круглый пузырь с мягкими краями и свечением.
class _Bubble extends StatelessWidget {
  const _Bubble({required this.icon});

  final Widget icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: _LiquidNavBarState._bubble,
      height: _LiquidNavBarState._bubble,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF8A7FFF), Color(0xFF6C63FF)],
        ),
        border: Border.all(color: Colors.white.withOpacity(0.18)),
        boxShadow: [
          BoxShadow(
            color: _LiquidNavBarState._bubbleColor.withOpacity(0.55),
            blurRadius: 22,
            spreadRadius: 1,
          ),
          BoxShadow(
            color: Colors.black.withOpacity(0.35),
            offset: const Offset(0, 6),
            blurRadius: 12,
          ),
        ],
      ),
      child: Center(child: icon),
    );
  }
}

class _NavItemView extends StatelessWidget {
  const _NavItemView({
    required this.item,
    required this.iconOpacity,
    required this.selected,
    required this.onTap,
  });

  final LiquidNavItem item;
  final double iconOpacity;
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
          SizedBox(
            width: 26,
            height: 26,
            child: Opacity(
              opacity: iconOpacity.clamp(0.0, 1.0),
              child: Icon(
                item.icon,
                size: 22,
                color: AppColors.navInactive,
              ),
            ),
          ),
          const SizedBox(height: 4),
          AnimatedDefaultTextStyle(
            duration: const Duration(milliseconds: 240),
            style: TextStyle(
              fontSize: 9,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
              color: selected ? AppColors.textPrimary : AppColors.navInactive,
            ),
            child: Text(
              item.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
