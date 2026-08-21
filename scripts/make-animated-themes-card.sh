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

S=1.5      # 960x540 = 640x360 x 1.5
N=50       # кадров, delay 10/100c -> ~5 секунд

# Мини-интерфейсы тем. Рисуются на 1280x720 и уменьшаются до 960x540:
# draw_ui считает координаты целыми числами, а дробный масштаб bash не умеет.
for th in indigo graphite crimson; do
  draw_ui "$th" 2 "/tmp/atc-ui2-$th.png"
  convert "/tmp/atc-ui2-$th.png" -resize 960x540 "/tmp/atc-ui-$th.png"
done

# Клинья-маски в 960x540 (диагонали из статичной карточки, масштаб 0.75).
convert -size 960x540 xc:black -fill white -draw "polygon 0,0 352,0 285,540 0,540" atc-w1.png
convert -size 960x540 xc:black -fill white -draw "polygon 352,0 660,0 592,540 285,540" atc-w2.png
convert -size 960x540 xc:black -fill white -draw "polygon 660,0 960,0 960,540 592,540" atc-w3.png

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
    D=$(bg_frame "$th" $S "$t" "$N")
    convert -size 960x540 xc:none -draw "$D" "/tmp/atc-f-$th.png"
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
