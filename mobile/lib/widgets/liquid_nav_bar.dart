import 'dart:math' as math;
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show HapticFeedback;

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

/// «Жидкая» нижняя навигация (liquid / gooey).
///
/// Компоновка — как в классическом gooey-таббаре: активный указатель —
/// фиолетовый кружок, который СИДИТ НАД верхней кромкой панели (выступает
/// вверх), утонув низом в круглой «лунке» панели. Иконка активного пункта
/// живёт внутри кружка (белая), в ряду её место пустует.
///
/// Цикл анимации при смене вкладки (560 мс):
///  1) SINK: кружок сплющивается и «тает» вниз, сливаясь с кромкой панели —
///     становится плоским «слизняком», лежащим на верхней кромке;
///  2) TRAVEL: слизняк съезжает по кромке к новой позиции — тянется по
///     направлению движения (squash & stretch), за ним тянется капля-хвост
///     (обе фигуры сливаются через goo-слой: blur + альфа-порог);
///  3) POP: на новом месте слизняк «выстреливает» вверх и надувается в круг
///     с перелётом (elasticOut — кружок чуть перелетает точку парковки и
///     оседает), goo-шея к кромке тянется и рвётся;
///  4) новая белая иконка всплывает внутри кружка, старая тонет.
///
/// API не изменился: LiquidNavItem(icon, label) / LiquidNavBar(index, items,
/// onChanged) — home_shell.dart трогать не нужно.
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
  static const double _overhang = 40; // зона НАД панелью, куда выступает круг
  static const double _barH = 64; // высота самой панели
  static const double _totalH = _overhang + _barH; // 104
  static const double _bubble = 46; // диаметр кружка
  static const double _radius = _bubble / 2;
  static const double _sinkDepth = 12; // насколько низ круга утоплен в панель
  static const double _gooBlur = 6;
  static const Color _gooColor = Color(0xFF6C63FF);

  // Край панели (верхняя кромка) в координатах виджета.
  static const double _edgeY = _overhang;
  // Y центра круга в парковке (над кромкой).
  static const double _parkY = _overhang - _sinkDepth; // 28
  // Y центра «слизняка» в движении (лежит на кромке).
  static const double _slugY = _overhang + 1; // 41

  // -- окна фаз (t: 0 → 1) --
  static const double _sinkEnd = 0.20; // круг → слизняк
  static const double _travelStart = 0.18; // начало съезда
  static const double _travelEnd = 0.78; // конец съезда
  static const double _popStart = 0.70; // начало выпрыгивания (внахлёст!)

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

  // ---- кривые фаз ----

  static double _clamp01(double v) => v.clamp(0.0, 1.0).toDouble();

  /// «Круглость» k: 1 — припаркованный круг над панелью, 0 — плоский
  /// слизняк на кромке. SINK гасит k (easeIn), POP возвращает elasticOut.
  double _roundness(double t) {
    final sink = 1.0 -
        Curves.easeInCubic.transform(_clamp01(t / _sinkEnd));
    final pop =
        Curves.elasticOut.transform(_clamp01((t - _popStart) / (1 - _popStart)));
    // до pop: k = sink; после pop-старта: sink уже 0 → k = pop.
    return sink + (1 - sink) * pop - sink * pop;
  }

  /// Прогресс съезда 0..1 в окне travel. [lag] — запаздывание для капли.
  double _travelT(double t, [double lag = 0]) {
    final u = _clamp01(
        (t - lag - _travelStart) / (_travelEnd - _travelStart));
    return Curves.easeInOutCubic.transform(u);
  }

  /// Кроссфейд иконки внутри круга (старая тонет / новая всплывает).
  double _fade(double t) => _clamp01((t - 0.42) / 0.14);

  /// Прозрачность иконки в ряду (0 = она уехала в кружок).
  double _rowIconOpacity(int i) {
    if (!_animating) return i == _currentIndex ? 0.0 : 1.0;
    final t = _controller.value;
    // старая появляется, как только круг начал таять
    if (i == _fromIndex) return Curves.easeOut.transform(_clamp01(t / 0.14));
    // новая исчезает, когда круг фактически допрыгнул и сел на неё
    if (i == _currentIndex) {
      return _clamp01(1.0 - (t - 0.80) / 0.12);
    }
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

              // k: 1 = круг над панелью, 0 = плоский слизняк на кромке.
              final k = _roundness(t);
              final kSoft = k.clamp(0.0, 1.15).toDouble();
              final k01 = _clamp01(k);

              // Центр: слизняк на кромке (k=0) ↔ круг над панелью (k=1).
              // elastic в k даёт перелёт выше парковки на POP.
              final cy = _slugY + (_parkY - _slugY) * kSoft;

              // Деформации: базовый squash при плющении + растяжение от
              // скорости (с лимитом!) + вертикальный «выстрел» при перелёте.
              final stretchV = math.min(
                0.60,
                vx * 0.02 / (0.35 + 0.65 * k01),
              );
              final sx = 1 +
                  (1 - k01) * 0.40 +
                  stretchV -
                  math.max(0.0, k - 1) * 0.30;
              final syBase =
                  0.22 + math.min(1.17, kSoft * 1.02) * 0.78;
              // объём сохраняем: чем сильнее тянем — тем тоньше тело
              final sy = syBase * (1 - 0.28 * (stretchV / 0.60));

              // Капля-хвост (только в движении).
              final speedFactor = (vx / 16).clamp(0.0, 1.0).toDouble();
              final flatness = 1 - k01;
              final xLag = fromX + span * _travelT(t, 0.09);

              // Шея к кромке: существует, пока круг «отрывается/прилипает».
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
                  // 1) Панель с «лункой», следующей за кружком.
                  Positioned(
                    left: 0,
                    right: 0,
                    top: _edgeY,
                    height: _barH,
                    child: CustomPaint(
                      painter: _BarPainter(
                        notchX: x,
                        notchDepth: 11 * k01,
                        notchHalfW: 27 * (0.55 + 0.45 * k01),
                      ),
                    ),
                  ),
                  // 2) GOO-слой: фиолетовый силуэт (круг/слизняк + капля +
                  //    шея + место сварки с кромкой) — склеивается альфа-порогом.
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
                              color: _gooColor,
                              center: blob,
                              radius: _radius,
                              scaleX: sx,
                              scaleY: sy,
                              edgeY: _edgeY,
                              trail: Offset(xLag, _slugY - 2),
                              trailRadius: 9 * speedFactor * flatness,
                              neck: neck,
                              weldWidth: 40 * k01,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  // 3) Ряд иконок + подписи (внутри панели).
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
                  // 4) Градиентная оболочка кружка поверх goo-силуэта.
                  Positioned(
                    left: x - _radius,
                    top: cy - _radius,
                    child: IgnorePointer(
                      child: Transform(
                        alignment: Alignment.center,
                        transform: Matrix4.identity()..scale(sx, sy),
                        child: _BubbleShell(
                          size: _bubble,
                          glow: 0.35 + 0.65 * k01,
                          // в плоском состоянии скрываем «кнопочный» лоск —
                          // слизняк должен выглядеть чистой каплей
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

  /// Белая иконка внутри круга. В плоском слизняке иконка не помещается —
  /// прячем; кроссфейд старая→новая по ходу перелёта.
  Widget _bubbleIcon(List<LiquidNavItem> items, double k) {
    const white = Colors.white;
    final visibility = _clamp01((k - 0.28) / 0.35);
    Widget icon;
    if (!_animating) {
      icon = Icon(items[_currentIndex].icon, color: white, size: 20);
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
                child: Icon(items[_fromIndex].icon, color: white, size: 20),
              ),
            ),
            Opacity(
              opacity: fade,
              child: Transform.translate(
                offset: Offset(0, -(1 - fade) * 14),
                child: Icon(items[_currentIndex].icon, color: white, size: 20),
              ),
            ),
          ],
        ),
      );
    }
    return Opacity(opacity: visibility, child: icon);
  }
}

/// Панель со скруглением и «лункой» (concave dip) на верхней кромке —
/// лунка следует за кружком и глубже всего, когда он припаркован.
class _BarPainter extends CustomPainter {
  _BarPainter({
    required this.notchX,
    required this.notchDepth,
    required this.notchHalfW,
  });

  final double notchX; // центр лунки (в координатах виджета)
  final double notchDepth; // 0..11
  final double notchHalfW;

  static const double _r = 26; // радиус скругления панели

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    // Контур панели: скруглённый прямоугольник, в верхнюю кромку которого
    // вписана плавная U-лунка (concave), следующая за кружком.
    final path = Path()..moveTo(_r, 0);
    if (notchDepth > 0.25) {
      final d = notchDepth;
      final hw = notchHalfW;
      final cx = notchX.clamp(hw * 1.9 + 2, w - hw * 1.9 - 2);
      path
        ..lineTo(cx - hw * 1.9, 0)
        ..cubicTo(cx - hw * 1.15, d * 0.10, cx - hw * 0.62, d * 0.92, cx, d)
        ..cubicTo(cx + hw * 0.62, d * 0.92, cx + hw * 1.15, d * 0.10,
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

    // Мягкая падающая тень (как Neu.shadows у старой версии).
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

    // Тонкая светлая окантовка (вдоль лунки тоже).
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

/// Фиолетовые «жидкие» фигуры (круг/слизняк, капля, шея, сварка с кромкой).
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

  /// Тянущаяся связка между телом и кромкой при отрыве/прилипании
  /// (null — не рисовать).
  final RRect? neck;

  /// «Сварной шов» — линза на кромке под припаркованным кругом: соединяет
  /// круг с панелью одним goo-силуэтом (круг как будто вырос из панели).
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

/// Градиентная «оболочка» кружка — объём, блик-бордер, неоновое свечение.
/// [shellness]: 1 = парковка (полный лоск), 0 = слизняк (чистая капля без
/// бордера/свечения, чтобы goo-силуэт читался сам по себе).
class _BubbleShell extends StatelessWidget {
  const _BubbleShell({
    required this.size,
    required this.glow,
    required this.shellness,
    required this.child,
  });

  final double size;
  final double glow;
  final double shellness;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF8A7FFF), Color(0xFF6C63FF)],
        ),
        border: Border.all(
          color: Colors.white.withOpacity(0.22 * shellness),
        ),
        boxShadow: [
          BoxShadow(
            color:
                const Color(0xFF6C63FF).withOpacity(0.55 * glow * shellness),
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
