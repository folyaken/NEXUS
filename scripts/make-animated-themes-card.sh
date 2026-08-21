#!/usr/bin/env bash
# Анимированная диагональная карточка трёх тем (GIF, 960x540, ~5 секунд).
#
# Та же композиция, что у статичной card-3themes.png — три оформления,
# сходящиеся к знаку NEXUS, — но каждый срез живёт: за мини-интерфейсом темы
# движется её фон (пакеты «Индиго», пыль «Графита», угли «Багрового»).
# Знак, заголовок, подписи и ссылки статичны, как у обычной карточки.
#
# Кадры фонов и мини-интерфейсы берутся из общих функций
# make-theme-previews.sh, поэтому карточка рисуется теми же цветами и
# координатами, что превью и само приложение.
#
# Использование: bash scripts/make-animated-themes-card.sh [путь-к-gif]
set -e

OUT="${1:-brand/posts/card-3themes.gif}"
case "$OUT" in
  /*) ;;
  *) OUT="$(pwd)/$OUT" ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POSTS="$ROOT/brand/posts"

# Общие функции: palette, draw_ui, bg_frame (режим библиотеки).
THEME_LIB_ONLY=1 source "$ROOT/scripts/make-theme-previews.sh"

F_BOLD=/tmp/fonts/Inter-Bold.ttf
F_SEMI=/tmp/fonts/Inter-Semi.ttf
F_REG=/tmp/fonts/Inter-Regular.ttf
F_MONO=/tmp/fonts/Mono-Medium.ttf

# Шрифты при необходимости нарезаются из шрифтов приложения.
if [ ! -f "$F_BOLD" ] || [ ! -f "$F_MONO" ]; then
  python3 - "$ROOT" <<'PYEOF'
import sys, os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.merge import Merger

root, fonts_dir = sys.argv[1], '/tmp/fonts'
os.makedirs(fonts_dir, exist_ok=True)
merger = Merger()

def instance(src, wght, out):
    f = TTFont(os.path.join(root, 'assets/fonts', src))
    instantiateVariableFont(f, {'wght': wght}, inplace=True)
    f.save(out)

for wght, name in [(400, 'Regular'), (600, 'Semi'), (700, 'Bold')]:
    instance('inter-latin-wght-normal.woff2', wght, f'{fonts_dir}/Inter-{name}-latin.ttf')
    instance('inter-cyrillic-wght-normal.woff2', wght, f'{fonts_dir}/Inter-{name}-cyr.ttf')
    merger.merge([f'{fonts_dir}/Inter-{name}-latin.ttf', f'{fonts_dir}/Inter-{name}-cyr.ttf']).save(f'{fonts_dir}/Inter-{name}.ttf')

instance('jetbrains-mono-latin-wght-normal.woff2', 500, f'{fonts_dir}/Mono-Medium-latin.ttf')
instance('jetbrains-mono-cyrillic-wght-normal.woff2', 500, f'{fonts_dir}/Mono-Medium-cyr.ttf')
merger.merge([f'{fonts_dir}/Mono-Medium-latin.ttf', f'{fonts_dir}/Mono-Medium-cyr.ttf']).save(f'{fonts_dir}/Mono-Medium.ttf')
PYEOF
fi

cd /tmp
rm -f atc-*.png

# Масштаб больше не нужен: клиновые фоны рисуются сразу в 960x540.
N=50       # кадров, delay 10/100c -> ~5 секунд

# Мини-интерфейсы тем. Рисуются на 1280x720 и уменьшаются до 960x540:
# draw_ui считает координаты целыми числами, а дробный масштаб bash не умеет.
for th in indigo graphite crimson; do
  draw_ui "$th" 2 "/tmp/atc-ui2-$th.png"
  convert "/tmp/atc-ui2-$th.png" -resize 960x540 "/tmp/atc-ui-$th.png"
done

# Клинья-маски в 960x540 (диагонали из статичной карточки, масштаб 0.75).
# `-alpha off` обязателен: у этих двух многоугольников ImageMagick сам
# добавляет альфа-канал, и CopyOpacity начинал брать непрозрачную альфу
# вместо яркости — клинья переставали резаться, темы накладывались друг
# на друга (в кадре «Индиго» пропадал целиком).
convert -size 960x540 xc:black -fill white -draw "polygon 0,0 352,0 285,540 0,540" -alpha off atc-w1.png
convert -size 960x540 xc:black -fill white -draw "polygon 352,0 660,0 592,540 285,540" -alpha off atc-w2.png
convert -size 960x540 xc:black -fill white -draw "polygon 660,0 960,0 960,540 592,540" -alpha off atc-w3.png

# --- Живой фон каждого клина (координаты сразу в 960x540) --------------------
# В отличие от общих превью, каждый элемент посажен ВНУТРЬ своего клина:
# иначе фирменное движение темы (дуги «Индиго», созвездие) уходило бы в
# соседние срезы, и клин выглядел бы пустым.
wedge_bg() { # $1=тема $2=кадр $3=всего кадров
  local th="$1" t="$2" n="$3"
  case "$th" in
    indigo)
      awk -v t="$t" -v n="$n" '
        BEGIN {
          pi = 3.14159265358979;
          ta = (8 + t * 47.0 / n) * pi / 180.0;
          tb = (-12 - t * 47.0 / n) * pi / 180.0;
          printf "fill #5e51d7 fill-opacity 0.12 circle 120,-60 120,260 ";
          printf "stroke rgba(124,242,213,0.16) stroke-width 1 fill none translate 150,270 rotate %.2f ellipse 0,0 135,95 0,360 ", ta*180/pi;
          xr = 135*cos(ta); yr = 95*sin(ta);
          printf "fill #7cf2d5 circle %d,%d %d,%d ", 150+xr, 270+yr, 150+xr, 270+yr+2;
          printf "stroke rgba(168,149,255,0.14) stroke-width 1 fill none translate 235,185 rotate %.2f ellipse 0,0 100,70 0,360 ", tb*180/pi;
          xb = 100*cos(tb); yb = 70*sin(tb);
          printf "fill #a895ff circle %d,%d %d,%d ", 235+xb, 185+yb, 235+xb, 185+yb+2;
          split("40,80 120,50 60,200 200,60 310,120 30,300", stars, " ");
          split("5.5 7 6 8 5 7.5", durs, " ");
          split("-2 -4 -1 -5 -3 -6", dels, " ");
          split("cyan violet mint cyan violet mint", cols, " ");
          for (i = 1; i <= 6; i++) {
            split(stars[i], xy, ",");
            phase = (t / n * 5.0 + dels[i] / durs[i]) * 2 * pi;
            op = 0.35 + 0.55 * (0.5 + 0.5 * sin(phase));
            c = (cols[i] == "cyan") ? "#7cf2d5" : (cols[i] == "violet") ? "#a895ff" : "#71f4b8";
            printf "fill %s fill-opacity %.2f circle %d,%d %d,%d ", c, op, xy[1], xy[2], xy[1], xy[2]+1;
          }
          hx = 300; hy = 80;
          p1 = (t / n * 5.0 - 3.0/9.0) * 2 * pi; op1 = 0.5 + 0.5*sin(p1);
          if (op1 > 0.6) printf "stroke rgba(124,242,213,0.4) stroke-width 1 fill none line %d,%d %d,%d ", hx, hy, hx+20, hy+16;
          printf "fill #7cf2d5 fill-opacity %.2f circle %d,%d %d,%d ", 0.4+0.5*op1, hx+20, hy+16, hx+20, hy+16+1;
          printf "fill #a895ff fill-opacity 0.55 circle %d,%d %d,%d ", hx-22, hy+30, hx-22, hy+30+1;
          printf "fill #7cf2d5 circle %d,%d %d,%d", hx, hy, hx, hy+1;
        }'
      ;;
    graphite)
      awk -v t="$t" -v n="$n" '
        BEGIN {
          pi = 3.14159265358979;
          gx = sin(t / n * 2 * pi) * 22;
          printf "fill #7563c5 fill-opacity 0.14 circle %d,%d %d,%d ", 490+gx, 40, 490+gx, 260;
          printf "fill #4b3a9e fill-opacity 0.12 circle %d,%d %d,%d ", 500-gx, 510, 500-gx, 730;
          split("380,120 420,300 460,60 500,240 540,420 580,150 620,330 650,90", ms, " ");
          split("2 1 2 1 3 1 2 1", szs, " ");
          split("0 -7 -3 -11 -5 -14 -2 -9", ds, " ");
          for (i = 1; i <= 8; i++) {
            split(ms[i], xy, ",");
            elapsed = t / n * 5.0 + (-ds[i]);
            prog = elapsed / 22.0; prog -= int(prog);
            yoff = 21 - 60 * prog;
            op = 0;
            if (prog < 0.18) op = prog / 0.18 * 0.7;
            else if (prog < 0.5) op = 0.7 + (prog - 0.18) / 0.32 * 0.3;
            else if (prog < 0.82) op = 1.0 - (prog - 0.5) / 0.32 * 0.35;
            else op = 0.65 * (1 - (prog - 0.82) / 0.18);
            if (op <= 0.02) continue;
            r = (szs[i] + 1) * 0.8;
            printf "fill #c6b6fb fill-opacity %.2f circle %d,%d %d,%d ", op, xy[1], xy[2] + yoff, xy[1], xy[2] + yoff + r;
          }
        }'
      ;;
    crimson)
      awk -v t="$t" -v n="$n" '
        BEGIN {
          pi = 3.14159265358979;
          br = 0.7 + 0.3 * sin(t / n * 2 * pi * 2.4);
          printf "fill #d63c4a fill-opacity %.2f circle %d,%d %d,%d ", 0.22*br, 740, 480, 740, 700;
          printf "fill #e37242 fill-opacity %.2f circle %d,%d %d,%d ", 0.14*br, 910, 400, 910, 600;
          split("690 730 770 810 850 890 930 710", xs, " ");
          split("3 2 4 2 3 2 4 2", szs, " ");
          split("19 24 16 22 18 26 15 21", durs, " ");
          split("-2 -9 -5 -14 -1 -17 -7 -12", ds, " ");
          for (i = 1; i <= 8; i++) {
            elapsed = t / n * 5.0 + (-ds[i]);
            prog = elapsed / durs[i]; prog -= int(prog);
            y = 552 - prog * 600;
            op = 0;
            if (prog < 0.15) op = prog / 0.15;
            else if (prog < 0.85) op = 1.0;
            else op = 1.0 * (1 - (prog - 0.85) / 0.15);
            if (op <= 0.02) continue;
            xoff = 16 * (prog - 0.5) * 2;
            col = (i % 3 == 0) ? "#ff9a5c" : (i % 3 == 1) ? "#e64248" : "#ff7d5a";
            r = szs[i] * 0.8;
            printf "fill %s fill-opacity %.2f circle %d,%d %d,%d ", col, op, xs[i] + xoff, y, xs[i] + xoff, y + r;
          }
        }'
      ;;
  esac
}

# --- Статичный оверлей: швы, знак, заголовок, подписи, футер ----------------
# Швы между темами
convert -size 960x540 xc:none \
  -draw "stroke rgba(255,255,255,0.10) stroke-width 1 fill none line 352,0 285,540" \
  -draw "stroke rgba(255,255,255,0.10) stroke-width 1 fill none line 660,0 592,540" \
  atc-seams.png

# Знак NEXUS в центре: та же геометрия, что в статичной карточке, уменьшена.
RIBBON_S='M35.3 99v-26l19.5-19.5 31.2 33.8 31.2-33.8 19.5 19.5v26l-19.5 19.5-31.2-33.8-31.2 33.8-19.5-19.5Z'
convert -size 160x160 xc:none \
  -fill 'rgba(10,9,14,0.86)' -stroke 'rgba(255,255,255,0.16)' -strokewidth 1 -draw "circle 80,80 80,75" \
  atc-badge.png
convert -size 160x160 xc:none \
  -stroke white -strokewidth 6 -fill none \
  -draw "stroke-linejoin round stroke-linecap round path '$RIBBON_S'" \
  atc-ribbon-mask.png
convert -size 160x160 gradient:'#7cf2d5'-'#a895ff' atc-ribbon-mask.png \
  -compose CopyOpacity -composite atc-ribbon.png
convert atc-badge.png atc-ribbon.png -composite \
  -fill none -stroke 'rgba(124,242,213,0.22)' -strokewidth 1 -draw "circle 80,80 80,88" \
  atc-badge2.png
convert atc-badge2.png -resize 120x120 atc-badge3.png

# Подложка заголовка с титулом
convert -size 315x120 xc:none \
  -fill 'rgba(10,9,14,0.6)' -stroke 'rgba(255,255,255,0.08)' -strokewidth 1 \
  -draw 'roundrectangle 0,0 314,119 15,15' atc-scrim.png
convert atc-scrim.png \
  -font "$F_BOLD" -pointsize 30 -fill '#f3f2f6' -annotate +24+36 'Три характера.' \
  -font "$F_BOLD" -pointsize 30 -fill '#8ea0ff' -annotate +66+74 'Один NEXUS' \
  -font "$F_REG" -pointsize 11.5 -fill '#a5a3ae' -annotate +34+98 'у каждого оформления — свой живой фон' \
  atc-scrim2.png

# Подписи тем по срезам
w1=$(convert -font "$F_MONO" -pointsize 17 label:'ИНДИГО' -format '%w' info:)
w2=$(convert -font "$F_MONO" -pointsize 17 label:'ГРАФИТ' -format '%w' info:)
w3=$(convert -font "$F_MONO" -pointsize 17 label:'БАГРОВОЕ' -format '%w' info:)
k1=$(convert -font "$F_MONO" -pointsize 7.5 label:'ОФОРМЛЕНИЕ 01' -format '%w' info:)
k2=$(convert -font "$F_MONO" -pointsize 7.5 label:'ОФОРМЛЕНИЕ 02' -format '%w' info:)
k3=$(convert -font "$F_MONO" -pointsize 7.5 label:'ОФОРМЛЕНИЕ 03' -format '%w' info:)

convert -size 960x540 xc:none \
  -font "$F_MONO" -pointsize 7.5 -kerning 2 -fill '#8f9bb0' \
    -annotate +$((176-k1/2))+460 'ОФОРМЛЕНИЕ 01' \
    -annotate +$((480-k2/2))+460 'ОФОРМЛЕНИЕ 02' \
    -annotate +$((784-k3/2))+460 'ОФОРМЛЕНИЕ 03' \
  -font "$F_MONO" -pointsize 17 -fill '#7cf2d5' -annotate +$((176-w1/2))+477 'ИНДИГО' \
  -font "$F_MONO" -pointsize 17 -fill '#c6b6fb' -annotate +$((480-w2/2))+477 'ГРАФИТ' \
  -font "$F_MONO" -pointsize 17 -fill '#d8505d' -annotate +$((784-w3/2))+477 'БАГРОВОЕ' \
  atc-labels.png

# Футер: разделитель и пилюли-ссылки
convert -size 147x27 xc:none \
  -fill 'rgba(255,255,255,0.05)' -stroke 'rgba(255,255,255,0.22)' -strokewidth 1 \
  -draw 'roundrectangle 0.5,0.5 146.5,26.5 8,8' atc-pillA.png
convert -size 247x27 xc:none \
  -fill 'rgba(255,255,255,0.05)' -stroke 'rgba(255,255,255,0.22)' -strokewidth 1 \
  -draw 'roundrectangle 0.5,0.5 246.5,26.5 8,8' atc-pillB.png

convert -size 960x540 xc:none \
  -draw "fill 'rgba(255,255,255,0.10)' rectangle 63,484 897,485" \
  atc-pillA.png -geometry +66+498 -composite \
  atc-pillB.png -geometry +646+498 -composite \
  -fill '#c6b6fb' -stroke none -draw "circle 81,511 81,513.5" \
  -fill '#c6b6fb' -stroke none -draw "circle 661,511 661,513.5" \
  -font "$F_MONO" -pointsize 11 -fill '#d9d4ee' -annotate +92+515 't.me/nexus_flex' \
  -font "$F_MONO" -pointsize 10 -fill '#d9d4ee' -annotate +675+515 'github.com/folyaken/NEXUS-releases' \
  -font "$F_REG" -pointsize 10 -fill '#716e7a' -annotate +757+510 'Windows 10 / 11 · 64-bit · бесплатно' \
  atc-foot.png

# Собираем оверлей в один слой
convert -size 960x540 xc:none \
  atc-seams.png -composite \
  atc-badge3.png -geometry +420+187 -composite \
  atc-scrim2.png -geometry +322+315 -composite \
  atc-labels.png -composite \
  atc-foot.png -composite \
  atc-overlay.png

# --- Кадры: три живых фона в клиньях + статичный оверлей ---------------------
for t in $(seq 0 $((N-1))); do
  for th in indigo graphite crimson; do
    D=$(wedge_bg "$th" "$t" "$N")
    convert -size 960x540 xc:"$(palette "$th" bg)" -draw "$D" "/tmp/atc-f-$th.png"
    convert "/tmp/atc-f-$th.png" "/tmp/atc-ui-$th.png" -composite "/tmp/atc-wb-$th.png"
  done
  convert "/tmp/atc-wb-indigo.png" atc-w1.png -compose CopyOpacity -composite /tmp/atc-s1.png
  convert "/tmp/atc-wb-graphite.png" atc-w2.png -compose CopyOpacity -composite /tmp/atc-s2.png
  convert "/tmp/atc-wb-crimson.png" atc-w3.png -compose CopyOpacity -composite /tmp/atc-s3.png
  convert -size 960x540 xc:'#050508' \
    /tmp/atc-s1.png -composite \
    /tmp/atc-s2.png -composite \
    /tmp/atc-s3.png -composite \
    atc-overlay.png -composite \
    "/tmp/atc-frame-$t.png"
done

convert -delay 10 -loop 0 /tmp/atc-frame-*.png -layers Optimize -strip "$OUT"
echo "анимированная карточка готова: $OUT ($(du -h "$OUT" | cut -f1))"
