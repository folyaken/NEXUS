#!/usr/bin/env bash
# Диагональная карточка поста: три оформления NEXUS на одном полотне.
#
# Три мини-интерфейса тем (scripts/make-theme-previews.sh) разрезаются по двум
# диагоналям и сходятся к знаку NEXUS в центре — сразу видно, что оформлений
# три, и у каждого свой характер. Внизу — ссылки на канал и релизы.
#
# Использование: bash scripts/make-three-themes-card.sh [путь-к-png]
set -e

OUT="${1:-brand/posts/card-3themes.png}"
case "$OUT" in
  /*) ;;
  *) OUT="$(pwd)/$OUT" ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POSTS="$ROOT/brand/posts"

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

if [ ! -f "$POSTS/theme-mock-indigo.png" ]; then
  bash "$ROOT/scripts/make-theme-previews.sh"
fi

cd /tmp
rm -f tc-*.png

# --- Клинья: три диагональных маски -----------------------------------------
convert -size 1280x720 xc:black -fill white -draw "polygon 0,0 470,0 380,720 0,720" tc-w1.png
convert -size 1280x720 xc:black -fill white -draw "polygon 470,0 880,0 790,720 380,720" tc-w2.png
convert -size 1280x720 xc:black -fill white -draw "polygon 880,0 1280,0 1280,720 790,720" tc-w3.png

# Срезы тем по маскам
convert "$POSTS/theme-mock-indigo.png"   tc-w1.png -compose CopyOpacity -composite tc-s1.png
convert "$POSTS/theme-mock-graphite.png" tc-w2.png -compose CopyOpacity -composite tc-s2.png
convert "$POSTS/theme-mock-crimson.png"  tc-w3.png -compose CopyOpacity -composite tc-s3.png

convert -size 1280x720 xc:'#050508' \
  tc-s1.png -composite tc-s2.png -composite tc-s3.png -composite \
  tc-base.png

# Швы между темами: тонкая светлая линия по диагоналям
convert tc-base.png \
  -draw "stroke rgba(255,255,255,0.10) stroke-width 1 fill none line 470,0 380,720" \
  -draw "stroke rgba(255,255,255,0.10) stroke-width 1 fill none line 880,0 790,720" \
  tc-seams.png

# --- Знак NEXUS в центре -----------------------------------------------------
# Лента — та же геометрия, что в карточке релиза, уменьшенная вдвое:
# координаты пересчитаны заранее, чтобы штрих рисовался чисто.
RIBBON_S='M35.3 99v-26l19.5-19.5 31.2 33.8 31.2-33.8 19.5 19.5v26l-19.5 19.5-31.2-33.8-31.2 33.8-19.5-19.5Z'
convert -size 160x160 xc:none \
  -fill 'rgba(10,9,14,0.86)' -stroke 'rgba(255,255,255,0.16)' -strokewidth 1 -draw "circle 80,80 80,75" \
  tc-badge.png
convert -size 160x160 xc:none \
  -stroke white -strokewidth 6 -fill none \
  -draw "stroke-linejoin round stroke-linecap round path '$RIBBON_S'" \
  tc-ribbon-mask.png
convert -size 160x160 gradient:'#7cf2d5'-'#a895ff' tc-ribbon-mask.png \
  -compose CopyOpacity -composite tc-ribbon.png
convert tc-badge.png tc-ribbon.png -composite \
  -fill none -stroke 'rgba(124,242,213,0.22)' -strokewidth 1 -draw "circle 80,80 80,88" \
  tc-badge2.png
convert tc-seams.png tc-badge2.png -geometry +560+250 -composite tc-center.png

# --- Титул и подпись под знаком ---------------------------------------------
convert -size 420x160 xc:none \
  -fill 'rgba(10,9,14,0.6)' -stroke 'rgba(255,255,255,0.08)' -strokewidth 1 \
  -draw 'roundrectangle 0,0 419,159 20,20' tc-scrim.png
convert tc-center.png tc-scrim.png -geometry +430+420 -composite tc-scrim2.png

convert tc-scrim2.png \
  -font "$F_BOLD" -pointsize 40 -fill '#f3f2f6' -annotate +462+468 'Три характера.' \
  -font "$F_BOLD" -pointsize 40 -fill '#8ea0ff' -annotate +522+520 'Один NEXUS' \
  -font "$F_REG" -pointsize 15 -fill '#a5a3ae' -annotate +500+554 'у каждого оформления — свой живой фон' \
  tc-title.png

# --- Подписи тем по срезам ---------------------------------------------------
w1=$(convert -font "$F_MONO" -pointsize 20 label:'ИНДИГО' -format '%w' info:)
w2=$(convert -font "$F_MONO" -pointsize 20 label:'ГРАФИТ' -format '%w' info:)
w3=$(convert -font "$F_MONO" -pointsize 20 label:'БАГРОВОЕ' -format '%w' info:)
k1=$(convert -font "$F_MONO" -pointsize 9 label:'ОФОРМЛЕНИЕ 01' -format '%w' info:)
k2=$(convert -font "$F_MONO" -pointsize 9 label:'ОФОРМЛЕНИЕ 02' -format '%w' info:)
k3=$(convert -font "$F_MONO" -pointsize 9 label:'ОФОРМЛЕНИЕ 03' -format '%w' info:)

convert tc-title.png \
  -font "$F_MONO" -pointsize 9 -kerning 2 -fill '#8f9bb0' \
    -annotate +$((235-k1/2))+614 'ОФОРМЛЕНИЕ 01' \
    -annotate +$((640-k2/2))+614 'ОФОРМЛЕНИЕ 02' \
    -annotate +$((1045-k3/2))+614 'ОФОРМЛЕНИЕ 03' \
  -font "$F_MONO" -pointsize 20 -fill '#7cf2d5' -annotate +$((235-w1/2))+636 'ИНДИГО' \
  -font "$F_MONO" -pointsize 20 -fill '#c6b6fb' -annotate +$((640-w2/2))+636 'ГРАФИТ' \
  -font "$F_MONO" -pointsize 20 -fill '#d8505d' -annotate +$((1045-w3/2))+636 'БАГРОВОЕ' \
  tc-labels.png

# --- Подвал: разделитель и пилюли-ссылки ------------------------------------
convert -size 196x36 xc:none \
  -fill 'rgba(255,255,255,0.05)' -stroke 'rgba(255,255,255,0.22)' -strokewidth 1 \
  -draw 'roundrectangle 0.5,0.5 195.5,35.5 10,10' tc-pillA.png
convert -size 330x36 xc:none \
  -fill 'rgba(255,255,255,0.05)' -stroke 'rgba(255,255,255,0.22)' -strokewidth 1 \
  -draw 'roundrectangle 0.5,0.5 329.5,35.5 10,10' tc-pillB.png

convert tc-labels.png \
  -draw "fill 'rgba(255,255,255,0.10)' rectangle 84,646 1196,647" \
  tc-pillA.png -geometry +88+664 -composite \
  tc-pillB.png -geometry +862+664 -composite \
  -fill '#c6b6fb' -stroke none -draw "circle 108,682 108,685.5" \
  -fill '#c6b6fb' -stroke none -draw "circle 882,682 882,685.5" \
  -font "$F_MONO" -pointsize 13.5 -fill '#d9d4ee' -annotate +122+686 't.me/nexus_flex' \
  -font "$F_MONO" -pointsize 12.5 -fill '#d9d4ee' -annotate +900+686 'github.com/folyaken/NEXUS-releases' \
  -font "$F_REG" -pointsize 12.5 -fill '#716e7a' -annotate +1010+680 'Windows 10 / 11 · 64-bit · бесплатно' \
  tc-foot.png

convert tc-foot.png -depth 8 -strip "$OUT"
echo "карточка трёх тем готова: $OUT"
