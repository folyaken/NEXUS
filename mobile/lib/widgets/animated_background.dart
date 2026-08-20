import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/theme.dart';

/// Живой фон: медленно дрейфующие цветные «облака» за контентом.
class AnimatedBackground extends StatefulWidget {
  const AnimatedBackground({super.key, required this.child});

  final Widget child;

  @override
  State<AnimatedBackground> createState() => _AnimatedBackgroundState();
}

class _AnimatedBackgroundState extends State<AnimatedBackground>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 28),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Widget _blob({
    required double t,
    required double size,
    required Color color,
    required double xAmp,
    required double yAmp,
    required double xCenter,
    required double yCenter,
    required double phase,
  }) {
    final angle = (t + phase) * 2 * math.pi;
    final dx = xAmp * math.sin(angle);
    final dy = yAmp * math.cos(angle * 1.3);
    return Positioned(
      left: xCenter - size / 2 + dx,
      top: yCenter - size / 2 + dy,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [
              color.withOpacity(0.30),
              color.withOpacity(0.0),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final t = _controller.value;
        return Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [AppColors.backgroundDark, AppColors.backgroundLight],
            ),
          ),
          child: Stack(
            children: [
              _blob(
                t: t,
                size: 380,
                color: AppColors.primaryCyan,
                xAmp: 60,
                yAmp: 80,
                xCenter: -60,
                yCenter: 120,
                phase: 0,
              ),
              _blob(
                t: t,
                size: 420,
                color: AppColors.primaryPurple,
                xAmp: 70,
                yAmp: 90,
                xCenter: 420,
                yCenter: 620,
                phase: 0.4,
              ),
              _blob(
                t: t,
                size: 260,
                color: AppColors.mint,
                xAmp: 50,
                yAmp: 60,
                xCenter: 300,
                yCenter: 160,
                phase: 0.75,
              ),
              Positioned.fill(child: child!),
            ],
          ),
        );
      },
      child: widget.child,
    );
  }
}
