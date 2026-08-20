import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback;

import '../core/theme.dart';

/// Элемент нижней навигации.
///
/// [color] — цвет «шарика»-указателя этой вкладки (в покое и в полёте).
/// Если null — фирменный фиолетовый.
class LiquidNavItem {
  const LiquidNavItem({
    required this.icon,
    required this.label,
    this.color,
  });

  final IconData icon;
  final String label;
  final Color? color;
}

/// «Жидкая» нижняя навигация (liquid / gooey).
///
/// Компоновка: активный указатель — цветной кружок (свой цвет у каждой
/// вкладки), который СИДИТ НАД верхней кромкой панели, утопленный низом в
/// глубокой «ямке» (U-выемка в кромке следует за кружком). Иконка внутри
/// кружка — ЧЁРНАЯ, иконки в ряду — серые.
///
/// Цикл анимации (560 мс):
///  1) SINK: кружок мягко сплющивается в «пилюлю» на кромке панели;
///  2) TRAVEL: пилюля съезжает к новой позиции, слегка вытягиваясь по
///     скорости (squash & stretch, ограничен), позади — капля-хвост,
///     склеенная goo-слоем (blur + альфа-порог); цвет плавно перетекает
///     в цвет новой вкладки;
///  3) POP: тело выпрыгивает вверх с лёгким перелётом (elasticOut),
///     goo-шея к кромке тянется и рвётся, ямка разъезжается под ним;
///  4) новая чёрная иконка всплывает внутри кружка.
///
/// API: LiquidNavItem(icon, label, color?) / LiquidNavBar(index, items,
/// onChanged).
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
  // -- геометрия --
  static const double _overhang = 40; // зона НАД панелью
  static const double _barH = 64; // высота панели
  static const double _totalH = _overhang + _barH; // 104
  static const double _bubble = 46; // диаметр круга
  static const double _radius = _bubble / 2;
  static const double _sinkDepth = 14; // низ круга утоплен в панель
  static const double _gooBlur = 6;

  // Край панели (верхняя кромка) в координатах виджета.
  static const double _edgeY = _overhang;
  // Y центра круга в парковке (над кромкой).
  static const double _parkY = _overhang - _sinkDepth; // 26
  // Y центра «пилюли» в движении (лежит на кромке).
  static const double _slugY = _overhang + 1; // 41

  // -- окна фаз (t: 0 → 1) --
  static const double _sinkEnd = 0.20;
  static const double _travelStart = 0.18;
  static const double _travelEnd = 0.78;
  static const double _popStart = 0.70;

  /// Цвет иконки внутри круга — почти чёрный (в тон фону).
  static const Color _iconInBubble = Color(0xFF0A0E1A);

  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 560),
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
    HapticFeedback.selectionClick();
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

  Color _itemColor(int i) => widget.items[i].color ?? AppColors.primaryPurple;

  // ---- кривые фаз ----

  static double _clamp01(double v) => v.clamp(0.0, 1.0).toDouble();

  /// «Круглость» k: 1 — припаркованный круг, 0 — пилюля на кромке.
  double _roundness(double t) {
    final sink = 1.0 - Curves.easeInCubic.transform(_clamp01(t / _sinkEnd));
    final pop = Curves.elasticOut
        .transform(_clamp01((t - _popStart) / (1 - _popStart)));
    return sink + (1 - sink) * pop - sink * pop;
  }

  /// Прогресс съезда 0..1 в окне travel. [lag] — запаздывание капли.
  double _travelT(double t, [double lag = 0]) {
    final u = _clamp01((t - lag - _travelStart) / (_travelEnd - _travelStart));
    return Curves.easeInOutCubic.transform(u);
  }

  /// Кроссфейд иконки внутри круга (и перетекание цвета шарика).
  double _fade(double t) => _clamp01((t - 0.42) / 0.14);

  /// Прозрачность иконки в ряду (0 = она уехала в кружок).
  double _rowIconOpacity(int i) {
    if (!_animating) return i == _currentIndex ? 0.0 : 1.0;
    final t = _controller.value;
    if (i == _fromIndex) {
      return Curves.easeOut.transform(_clamp01(t / 0.14));
    }
    if (i == _currentIndex) return _clamp01(1.0 - (t - 0.80) / 0.12);
    return 1.0;
  }

  @override
  Widget build(BuildContext context) {
    final items = widget.items;

    return SizedBox(
      height: _totalH,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final itemWidth = constraints.maxWidth / items.length;

          return AnimatedBuilder(
            animation: _controller,
            builder: (context, _) {
              final t = _animating ? _controller.value : 1.0;

              final fromX = _fromIndex * itemWidth + itemWidth / 2;
              final toX = _currentIndex * itemWidth + itemWidth / 2;
              final span = toX - fromX;

              final m = _travelT(t);
              final x = fromX + span * m;

              // Мгновенная скорость съезда (px/кадр при 60 fps).
              const dtFrame = 16.7 / 560;
              final vx = (span * (_travelT(_clamp01(t + dtFrame)) - m)).abs();

              // k: 1 = круг над панелью, 0 = пилюля на кромке.
              final k = _roundness(t);
              final kSoft = k.clamp(0.0, 1.15).toDouble();
              final k01 = _clamp01(k);

              // Цвет шарика: перетекает в цвет целевой вкладки посреди пути.
              final fade = _fade(t);
              final gooColor = !_animating
                  ? _itemColor(_currentIndex)
                  : (Color.lerp(
                          _itemColor(_fromIndex), _itemColor(_currentIndex),
                          fade) ??
                      _itemColor(_currentIndex));

              // Центр тела: пилюля на кромке (k=0) ↔ круг над панелью (k=1).
              final cy = _slugY + (_parkY - _slugY) * kSoft;

              // Деформации — МЯГКИЕ: пилюля ~sx1.35 / sy0.58, плюс
              // ограниченное растяжение от скорости.
              final stretchV =
                  math.min(0.45, vx * 0.02 / (0.35 + 0.65 * k01));
              final popOver = math.max(0.0, k - 1); // перелёт при приземлении
              final sx = 1 + (1 - k01) * 0.35 + stretchV - popOver * 0.15;
              final sy = (1 - (1 - k01) * 0.42) / (1 + 0.35 * stretchV) +
                  popOver * 0.35;

              // Капля-хвост (только в движении).
              final speedFactor = (vx / 16).clamp(0.0, 1.0).toDouble();
              final flatness = 1 - k01;
              final xLag = fromX + span * _travelT(t, 0.09);

              // Шея к кромке: тянется при отрыве/прилипании.
              final neckW = 2 * _radius * 0.42 * (1 - k01) + 5;
              final neckTop = cy + _radius * sy * 0.7 - 2;
              const neckBottom = _edgeY + 3;
              final RRect? neck =
                  (k > 0.03 && k < 0.78 && neckBottom - neckTop > 2)
                      ? RRect.fromRectAndRadius(
                          Rect.fromLTRB(
                            x - neckW / 2,
                            neckTop,
                            x + neckW / 2,
                            neckBottom,
                          ),
                          Radius.circular(neckW / 2),
                        )
                      : null;

              final blob = Offset(x, cy);

              return Stack(
                clipBehavior: Clip.none,
                children: [
                  // 1) Панель с глубокой «ямкой», следующей за кружком.
                  Positioned(
                    left: 0,
                    right: 0,
                    top: _edgeY,
                    height: _barH,
                    child: CustomPaint(
                      painter: _BarPainter(
                        notchX: x,
                        notchDepth: 20 * k01,
                        notchHalfW: 23 * (0.55 + 0.45 * k01),
                      ),
                    ),
                  ),
                  // 2) GOO-слой — цветной силуэт, склеенный альфа-порогом.
                  Positioned.fill(
                    child: IgnorePointer(
                      child: ColorFiltered(
                        colorFilter: const ColorFilter.matrix(<double>[
                          1, 0, 0, 0, 0,
                          0, 1, 0, 0, 0,
                          0, 0, 1, 0, 0,
                          0, 0, 0, 18, -1785, // a' = 18a − 7 (порог)
                        ]),
                        child: ImageFiltered(
                          imageFilter: ImageFilter.blur(
                            sigmaX: _gooBlur,
                            sigmaY: _gooBlur,
                          ),
                          child: CustomPaint(
                            painter: _GooPainter(
                              color: gooColor,
                              center: blob,
                              radius: _radius,
                              scaleX: sx,
                              scaleY: sy,
                              edgeY: _edgeY,
                              trail: Offset(xLag, _slugY - 2),
                              trailRadius: 8 * speedFactor * flatness,
                              neck: neck,
                              weldWidth: 30 * k01,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  // 3) Ряд серых иконок + подписи (внутри панели).
                  Positioned(
                    left: 0,
                    right: 0,
                    top: _edgeY,
                    height: _barH,
                    child: Row(
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
                  ),
                  // 4) Градиентная оболочка круга поверх goo-силуэта.
                  Positioned(
                    left: x - _radius,
                    top: cy - _radius,
                    child: IgnorePointer(
                      child: Transform(
                        alignment: Alignment.center,
                        transform: Matrix4.identity()..scale(sx, sy),
                        child: _BubbleShell(
                          size: _bubble,
                          base: gooColor,
                          glow: 0.35 + 0.65 * k01,
                          shellness: _clamp01((k - 0.25) / 0.5),
                          child: _bubbleIcon(items, k),
                        ),
                      ),
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

  /// ЧЁРНАЯ иконка внутри круга; в плоской пилюле прячется.
  /// Кроссфейд старая→новая по ходу перелёта.
  Widget _bubbleIcon(List<LiquidNavItem> items, double k) {
    final visibility = _clamp01((k - 0.28) / 0.35);
    Widget icon;
    if (!_animating) {
      icon = Icon(items[_currentIndex].icon, color: _iconInBubble, size: 20);
    } else {
      final fade = _fade(_controller.value);
      icon = SizedBox(
        width: 22,
        height: 22,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Opacity(
              opacity: 1 - fade,
              child: Transform.translate(
                offset: Offset(0, fade * 14),
                child: Icon(items[_fromIndex].icon,
                    color: _iconInBubble, size: 20),
              ),
            ),
            Opacity(
              opacity: fade,
              child: Transform.translate(
                offset: Offset(0, -(1 - fade) * 14),
                child: Icon(items[_currentIndex].icon,
                    color: _iconInBubble, size: 20),
              ),
            ),
          ],
        ),
      );
    }
    return Opacity(opacity: visibility, child: icon);
  }
}

/// Панель со скруглением и глубокой U-«ямкой» на верхней кромке —
/// ямка следует за кружком и глубже всего, когда он припаркован.
class _BarPainter extends CustomPainter {
  _BarPainter({
    required this.notchX,
    required this.notchDepth,
    required this.notchHalfW,
  });

  final double notchX;
  final double notchDepth; // 0..20
  final double notchHalfW;

  static const double _r = 26;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    // Контур: скруглённый прямоугольник с U-ямкой в верхней кромке.
    final path = Path()..moveTo(_r, 0);
    double cx = 0;
    if (notchDepth > 0.25) {
      final d = notchDepth;
      final hw = notchHalfW;
      cx = notchX.clamp(hw * 1.9 + 2, w - hw * 1.9 - 2);
      path
        ..lineTo(cx - hw * 1.9, 0)
        // крутые стенки + округлое дно → ощущение «вдавили»
        ..cubicTo(cx - hw * 1.05, d * 0.06, cx - hw * 0.58, d * 0.95, cx, d)
        ..cubicTo(cx + hw * 0.58, d * 0.95, cx + hw * 1.05, d * 0.06,
            cx + hw * 1.9, 0);
    }
    path
      ..lineTo(w - _r, 0)
      ..arcToPoint(Offset(w, _r), radius: const Radius.circular(_r))
      ..lineTo(w, h - _r)
      ..arcToPoint(Offset(w - _r, h), radius: const Radius.circular(_r))
      ..lineTo(_r, h)
      ..arcToPoint(Offset(0, h - _r), radius: const Radius.circular(_r))
      ..lineTo(0, _r)
      ..arcToPoint(Offset(_r, 0), radius: const Radius.circular(_r))
      ..close();

    // Мягкая падающая тень панели.
    canvas.drawShadow(path, Colors.black.withOpacity(0.55), 16, true);

    // Заливка: тёмный вертикальный градиент.
    final fill = Paint()
      ..style = PaintingStyle.fill
      ..shader = const LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0xFF0E1424), Color(0xFF080C16)],
      ).createShader(Rect.fromLTWH(0, 0, w, h));
    canvas.drawPath(path, fill);

    // Перманентная внутренняя тень в ямке — объём «вдавленности».
    if (notchDepth > 0.5) {
      canvas.save();
      canvas.clipPath(path);
      final pit = Paint()
        ..color = Colors.black.withOpacity(0.50)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);
      canvas.drawOval(
        Rect.fromCenter(
          center: Offset(cx, notchDepth * 0.9),
          width: notchHalfW * 2.6,
          height: 12,
        ),
        pit,
      );
      canvas.restore();
    }

    // Тонкая светлая окантовка (вдоль ямки тоже).
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = Colors.white.withOpacity(0.07);
    canvas.drawPath(path, stroke);
  }

  @override
  bool shouldRepaint(_BarPainter old) =>
      old.notchX != notchX ||
      old.notchDepth != notchDepth ||
      old.notchHalfW != notchHalfW;
}

/// Цветные «жидкие» фигуры (тело, капля, шея, сварка к кромке).
/// После blur + альфа-порога визуально сливаются в единое тело.
class _GooPainter extends CustomPainter {
  _GooPainter({
    required this.color,
    required this.center,
    required this.radius,
    required this.scaleX,
    required this.scaleY,
    required this.edgeY,
    required this.trail,
    required this.trailRadius,
    required this.neck,
    required this.weldWidth,
  });

  final Color color;
  final Offset center;
  final double radius;
  final double scaleX;
  final double scaleY;
  final double edgeY;
  final Offset trail;
  final double trailRadius;

  /// Тянущаяся связка с кромкой при отрыве/прилипании (null — нет).
  final RRect? neck;

  /// «Сварной шов» — линза на кромке под припаркованным кругом.
  final double weldWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    // Основное тело.
    canvas.drawOval(
      Rect.fromCenter(
        center: center,
        width: radius * 2 * scaleX,
        height: radius * 2 * scaleY,
      ),
      paint,
    );

    // Капля-хвост.
    if (trailRadius > 0.5) canvas.drawCircle(trail, trailRadius, paint);

    // Шея.
    final neck = this.neck;
    if (neck != null) canvas.drawRRect(neck, paint);

    // Сварной шов на кромке (в парковке).
    if (weldWidth > 0.5) {
      canvas.drawOval(
        Rect.fromCenter(
          center: Offset(center.dx, edgeY + 1),
          width: weldWidth,
          height: 7,
        ),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_GooPainter oldDelegate) => true;
}

/// Градиентная оболочка круга: объём, блик-бордер, цветное свечение.
/// [shellness]: 1 = парковка (полный лоск), 0 = пилюля (чистый goo-силуэт).
class _BubbleShell extends StatelessWidget {
  const _BubbleShell({
    required this.size,
    required this.base,
    required this.glow,
    required this.shellness,
    required this.child,
  });

  final double size;
  final Color base;
  final double glow;
  final double shellness;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final light = Color.lerp(base, Colors.white, 0.22) ?? base;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [light, base],
        ),
        border: Border.all(
          color: Colors.white.withOpacity(0.22 * shellness),
        ),
        boxShadow: [
          BoxShadow(
            color: base.withOpacity(0.55 * glow * shellness),
            blurRadius: 22,
            spreadRadius: 1,
          ),
          BoxShadow(
            color: Colors.black.withOpacity(0.35 * shellness),
            offset: const Offset(0, 6),
            blurRadius: 12,
          ),
        ],
      ),
      child: Center(child: child),
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
    return Semantics(
      button: true,
      selected: selected,
      label: item.label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 26,
              height: 26,
              child: Opacity(
                opacity: iconOpacity,
                // иконки в ряду — серые
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
                color:
                    selected ? AppColors.textPrimary : AppColors.navInactive,
              ),
              child: Text(
                item.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
