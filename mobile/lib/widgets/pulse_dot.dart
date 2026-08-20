import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Пульсирующий индикатор состояния (зелёный/янтарный/красный/серый).
class PulseDot extends StatefulWidget {
  const PulseDot({
    super.key,
    this.color = AppColors.mint,
    this.size = 10,
    this.pulse = true,
  });

  final Color color;
  final double size;
  final bool pulse;

  @override
  State<PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<PulseDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.pulse) {
      return Container(
        width: widget.size,
        height: widget.size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: widget.color,
          boxShadow: [
            BoxShadow(
              color: widget.color.withOpacity(alpha: 0.6),
              blurRadius: 6,
            ),
          ],
        ),
      );
    }

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final t = _controller.value;
        final glow = 6 + 10 * t;
        final alpha = 0.7 - 0.5 * t;
        return Container(
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: widget.color,
            boxShadow: [
              BoxShadow(
                color: widget.color.withOpacity(alpha: alpha),
                blurRadius: glow,
                spreadRadius: glow * 0.2,
              ),
            ],
          ),
        );
      },
    );
  }
}
