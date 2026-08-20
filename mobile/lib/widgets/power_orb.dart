import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Анимированная орбита питания VPN: пульсирующие кольца + вращающееся пунктирное.
class PowerOrb extends StatefulWidget {
  const PowerOrb({
    super.key,
    required this.connected,
    required this.onTap,
    this.size = 200,
  });

  final bool connected;
  final VoidCallback? onTap;
  final double size;

  @override
  State<PowerOrb> createState() => _PowerOrbState();
}

class _PowerOrbState extends State<PowerOrb>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 6),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = widget.size;
    final coreSize = size * 0.52;

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final t = _controller.value;

        Widget pulseRing(double phase, Color color) {
          final p = (t + phase) % 1.0;
          final ringSize = size * (0.62 + 0.38 * p);
          return Center(
            child: Container(
              width: ringSize,
              height: ringSize,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: color.withOpacity((1 - p) * 0.5),
                  width: 1.6,
                ),
              ),
            ),
          );
        }

        return GestureDetector(
          onTap: widget.onTap,
          child: SizedBox(
            width: size,
            height: size,
            child: Stack(
              alignment: Alignment.center,
              children: [
                pulseRing(0.0, AppColors.primaryCyan),
                pulseRing(0.5, AppColors.primaryPurple),
                // вращающееся пунктирное кольцо
                Transform.rotate(
                  angle: t * 2 * math.pi,
                  child: CustomPaint(
                    size: Size(size * 0.86, size * 0.86),
                    painter: _DashedRingPainter(
                      color: widget.connected
                          ? AppColors.primaryCyan
                          : AppColors.textMuted.withOpacity(0.5),
                    ),
                  ),
                ),
                // ядро
                AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  width: coreSize,
                  height: coreSize,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: widget.connected
                          ? [
                              AppColors.primaryCyan.withOpacity(0.35),
                              AppColors.cardDark,
                            ]
                          : [AppColors.cardLight, AppColors.cardDark],
                    ),
                    border: Border.all(
                      color: widget.connected
                          ? AppColors.primaryCyan.withOpacity(0.7)
                          : Colors.white.withOpacity(0.08),
                      width: 1.4,
                    ),
                    boxShadow: widget.connected
                        ? [
                            BoxShadow(
                              color: AppColors.primaryCyan.withOpacity(0.5),
                              blurRadius: 40,
                              spreadRadius: 2,
                            ),
                          ]
                        : [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.5),
                              blurRadius: 20,
                            ),
                          ],
                  ),
                  child: Icon(
                    Icons.power_settings_new_rounded,
                    size: coreSize * 0.44,
                    color: widget.connected
                        ? AppColors.primaryCyan
                        : AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _DashedRingPainter extends CustomPainter {
  _DashedRingPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    final radius = size.width / 2 - 3;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8
      ..strokeCap = StrokeCap.round;

    const segments = 36;
    for (int i = 0; i < segments; i++) {
      final start = (i / segments) * 2 * math.pi;
      final sweep = 0.55 * 2 * math.pi / segments;
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        start,
        sweep,
        false,
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _DashedRingPainter old) => old.color != color;
}
