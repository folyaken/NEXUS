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

/// «Жидкая» нижняя навигация (liquid / gooey) — по референсу
/// video_2026-08-20_20-35-01.mp4.
///
/// Компоновка: цветной кружок (свой цвет у вкладки) паркуется НА верхней
/// кромке панели: ≈2/3 над ней, ≈1/3 утоплена в панель. Под кружком в
/// кромке выдавлена плавная «ямка» (косинусная лунка, концентричная
/// кружку — всегда ровная). Иконка внутри кружка — почти чёрная, иконки
/// ряда — серые.
///
/// Цикл анимации (560 мс), строго по референсу:
///  1) SINK: круг физично оседает на кромку, превращаясь в компактную
///     линзу (≈1.4× ширины, ≈0.38 высоты — НЕ «колбаска»);
///  2) TRAVEL: линза едет по кромке, слегка релаксируя по мере движения
///     (sx ≈1.38 → 1.28), малая живая растяжка от скорости, капля-хвост
///     через goo-слой (blur + альфа-порог), цвет перетекает в цвет
///     целевой вкладки;
///  3) POP: на месте тело выпрыгивает вверх с лёгким перелётом
///     (elasticOut), goo-шея тянется и рвётся, ямка разъезжается;
///  4) новая чёрная иконка всплывает внутри кружка.
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
  static const double _overhang = 44; // зона НАД панелью
  static const double _barH = 64; // высота панели
  static const double _totalH = _overhang + _barH; // 108
  static const double _bubble = 46; // диаметр круга
  static const double _radius = _bubble / 2;
  static const double _gooBlur = 6;

  // Край панели (верхняя кромка) в координатах виджета.
  static const double _edgeY = _overhang;
  // Центр круга в парковке: на _sinkDepth ВЫШЕ кромки (низ утоплен на
  // R+_sinkDepth-_edgeY = 13 px под кромку — как в референсе).
  static const double _sinkDepth = 10;
  static const double _parkY = _edgeY - _sinkDepth; // 34
  // Центр эллипса в движении — чуть ВЫШЕ кромки, низ сидит в кромке.
  static const double _slugY = _edgeY - 2; // 42

  // -- окна фаз (t: 0 → 1) --
  static const double _sinkEnd = 0.20;
  static const double _travelStart = 0.18;
  static const double _travelEnd = 0.78;
  static const double _popStart = 0.70;

  /// Иконка внутри круга — почти чёрная (в тон фону), как в референсе.
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

  /// «Круглость» k: 1 — припаркованный круг, 0 — эллипс на кромке.
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

              // k: 1 = круг над панелью, 0 = эллипс на кромке.
              final k = _roundness(t);
              final kSoft = k.clamp(0.0, 1.15).toDouble();
              final k01 = _clamp01(k);

              // Цвет шарика перетекает в цвет целевой вкладки посреди пути.
              final fade = _fade(t);
              final gooColor = !_animating
                  ? _itemColor(_currentIndex)
                  : (Color.lerp(
                          _itemColor(_fromIndex), _itemColor(_currentIndex),
                          fade) ??
                      _itemColor(_currentIndex));

              // Центр тела: на кромке (k=0) ↔ припаркован над ней (k=1).
              final cy = _slugY + (_parkY - _slugY) * kSoft;

              // «Физичный» squash (по референсу): в полёте — ТОЛСТАЯ
              // КОРОТКАЯ линза ≈1.3–1.45× диаметра в ширину и ~0.36–0.40
              // в высоту, лежащая строча на кромке; чуть релаксирует к
              // концу пути; небольшая живая растяжка от скорости.
              final travelRelax = Curves.easeOut.transform(m);
              final flatStretch = 0.38 - 0.10 * travelRelax; // 0.38 → 0.28
              final stretchV =
                  math.min(0.12, vx * 0.006 / (0.5 + 0.5 * k01));
              final popOver = math.max(0.0, k - 1);
              final sx =
                  1 + (1 - k01) * flatStretch + stretchV - popOver * 0.15;
              final sy =
                  (1 - (1 - k01) * 0.62) / (1 + 0.5 * stretchV) +
                      popOver * 0.40;

              // Капля-хвост (только в движении): следует с запаздыванием,
              // но не дальше 0.7 полуширины линзы — не отрывается от тела.
              final speedFactor = (vx / 16).clamp(0.0, 1.0).toDouble();
              final flatness = 1 - k01;
              final lagRaw = fromX + span * _travelT(t, 0.09);
              final lagLim = _radius * sx * 0.7;
              final xLag = span >= 0
                  ? math.max(lagRaw, x - lagLim)
                  : math.min(lagRaw, x + lagLim);

              // Шея к кромке при отрыве/прилипании.
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
                  // 1) Панель с плавной «ямкой» (косинусная лунка), следующей
                  //    за кружком.
                  Positioned(
                    left: 0,
                    right: 0,
                    top: _edgeY,
                    height: _barH,
                    child: CustomPaint(
                      painter: _BarPainter(
                        notchX: x,
                        notchDepth: 16 * k01,
                        notchHalfW: 21.7 * (0.62 + 0.38 * k01),
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
                              trail: Offset(xLag, _slugY + 2),
                              trailRadius: 7 * speedFactor * flatness,
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

  /// ЧЁРНАЯ иконка внутри круга; в плоском эллипсе прячется.
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

/// Панель с «ямкой» — плавной косинусной лункой в верхней кромке.
/// Лунка концентрична кружку (ширина ≈ хорда круга на уровне кромки),
/// поэтому посадка всегда РОВНАЯ, без перекосов. Дно пологое, стыки с
/// кромкой касательные (нулевой наклон) — гладко при любой глубине.
class _BarPainter extends CustomPainter {
  _BarPainter({
    required this.notchX,
    required this.notchDepth,
    required this.notchHalfW,
  });

  final double notchX;
  final double notchDepth; // 0..16 (утопление круга + 3 px на дно)
  final double notchHalfW; // ~хорда круга на уровне кромки x 1.05

  // Угол панели — меньше полуширины ямки крайних вкладок, чтобы лунка
  // никогда не врезалась в закругление угла (иначе ямка «кривая»).
  static const double _r = 14;
  static const int _segments = 24; // дискретизация косинуса

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    final path = Path()..moveTo(_r, 0);
    double cx = 0;
    if (notchDepth > 0.25) {
      final hw = notchHalfW;
      cx = notchX.clamp(hw + _r + 2, w - hw - _r - 2);
      final left = cx - hw;
      path.lineTo(left, 0);
      // Лунка как косинусная лоба: d(x) = D * (0.5 + 0.5*cos(pi*t)),
      // t ∈ [-1..1]. Касательная нулевая и в стыках, и на дне.
      double px = left, py = 0;
      for (var s = 1; s <= _segments; s++) {
        final tt = -1.0 + 2.0 * s / _segments; // -1..1
        final nx = cx + hw * tt;
        final ny = notchDepth * (0.5 + 0.5 * math.cos(math.pi * tt));
        // n-точечная ломаная сглажена малым шагом — визуально идеальная кривая.
        path.quadraticBezierTo(px, py, (px + nx) / 2, (py + ny) / 2);
        px = (px + nx) / 2;
        py = (py + ny) / 2;
      }
      path.lineTo(cx + hw, 0);
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

    // Внутренняя тень в ямке — объём «вдавленности».
    if (notchDepth > 0.5) {
      canvas.save();
      canvas.clipPath(path);
      final pit = Paint()
        ..color = Colors.black.withOpacity(0.60)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 7);
      canvas.drawOval(
        Rect.fromCenter(
          center: Offset(cx, notchDepth * 0.85),
          width: notchHalfW * 2.2,
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
      ..color = Colors.white.withOpacity(0.10);
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
