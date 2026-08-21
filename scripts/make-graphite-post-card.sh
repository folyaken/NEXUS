#!/usr/bin/env bash
# Карточка релиза NEXUS для Telegram (1280x720), оформление «Графит».
#
# Дизайн повторяет язык интерфейса: графитовый фон со светящейся пылью,
# лавандовая пара #c6b6fb / #7a63e0 из темы, знак NEXUS как в приложении
# (лента с градиентом, тень и светящееся ядро), Space Grotesk у названия,
# Inter у подписей, JetBrains Mono у служебного текста и ссылок.
#
# Стрелки и типографские значки рисуются фигурами, а не текстом: в шрифтах
# приложения нарезаны только кириллица и латиница, остальное превращалось
# в пустое место.
#
# Использование:  bash scripts/make-graphite-post-card.sh [путь-к-png]
set -e

OUT="${1:-brand/posts/card-1.6.0.png}"
# Скрипт работает в /tmp, поэтому путь вывода сразу переводим в абсолютный.
case "$OUT" in
  /*) ;;
  *) OUT="$(pwd)/$OUT" ;;
esac

W=1280; H=720
BG='#0a090e'        # --bg темы «Графит»
INK='#f3f2f6'       # --text
MUT='#a5a3ae'       # --muted
DIM='#716e7a'       # --muted-2
LAV='#c6b6fb'       # светлая лаванда: текст, значки, тонкие линии
DEEP='#7a63e0'      # глубокая лаванда: заливки, свечения

F_BOLD=/tmp/fonts/Inter-Bold.ttf
F_SEMI=/tmp/fonts/Inter-Semi.ttf
F_REG=/tmp/fonts/Inter-Regular.ttf
F_MONO=/tmp/fonts/Mono-Medium.ttf
F_GROT=/tmp/fonts/SpaceGrotesk-Bold.ttf

# ── Шрифты: если их ещё нет, нарезаются из шрифтов приложения ─────────────
if [ ! -f "$F_BOLD" ] || [ ! -f "$F_REG" ] || [ ! -f "$F_MONO" ] || [ ! -f "$F_GROT" ]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

# У названия NEXUS — фирменный гротеск заголовков. Он латинский, кириллицы
# в нём и не нужно.
instance('space-grotesk-latin-wght-normal.woff2', 700, f'{fonts_dir}/SpaceGrotesk-Bold.ttf')
PYEOF
fi

cd /tmp
rm -f g-*.png

# ── Фон: пятна как в .app-shell, диагонали, пыль и орбиты ─────────────────
convert -size 900x900 radial-gradient:"$DEEP"-none -alpha set -channel A -evaluate multiply 0.20 +channel g-glowA.png
convert -size 820x820 radial-gradient:'#4b3a9e'-none -alpha set -channel A -evaluate multiply 0.16 +channel g-glowB.png
convert -size ${W}x${H} xc:"$BG" \
  g-glowA.png -geometry +560-420 -composite \
  g-glowB.png -geometry -260+440 -composite \
  g-bg1.png

convert -size ${W}x${H} xc:none \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 980,0 1280,300" \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 1060,0 1280,220" \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 900,0 1280,380" \
  -alpha set -channel A -evaluate multiply 0.04 +channel g-lines.png
convert g-bg1.png g-lines.png -composite g-bg2.png

# Тонкие орбиты вокруг будущей плитки с логотипом — отсылка к орбитам
# «Обзора». Плитка ляжет поверх них, кольца останутся видимыми по краям.
convert g-bg2.png \
  -draw "stroke 'rgba(198,182,251,0.055)' stroke-width 1 fill none circle 1002,272 1002,458" \
  -draw "stroke 'rgba(198,182,251,0.035)' stroke-width 1 fill none circle 1002,272 1002,498" \
  g-bg3.png

# Вертикальная линия-разделитель между колонкой текста и логотипом.
convert g-bg3.png \
  -draw "fill 'rgba(255,255,255,0.05)' rectangle 764,96 765,640" \
  g-bg4.png

# Пыль — фирменная черта живого фона «Графита»: редкие мягкие точки.
convert -size ${W}x${H} xc:none \
  -fill 'rgba(198,182,251,0.30)' -draw "circle 60,300 60,303" \
  -fill 'rgba(198,182,251,0.18)' -draw "circle 700,150 700,152" \
  -fill 'rgba(198,182,251,0.22)' -draw "circle 1240,90 1240,92" \
  -fill 'rgba(198,182,251,0.20)' -draw "circle 1210,610 1210,612" \
  -fill 'rgba(198,182,251,0.16)' -draw "circle 60,120 60,122" \
  -fill 'rgba(198,182,251,0.24)' -draw "circle 760,430 760,432" \
  -fill 'rgba(198,182,251,0.16)' -draw "circle 800,520 800,522" \
  -fill 'rgba(198,182,251,0.22)' -draw "circle 300,700 300,702" \
  -fill 'rgba(198,182,251,0.18)' -draw "circle 560,160 560,162" \
  -fill 'rgba(198,182,251,0.26)' -draw "circle 84,646 84,649" \
  -blur 0x2.5 g-dust.png
convert g-bg4.png g-dust.png -composite g-bg5.png

# ── Плитка логотипа: стеклянный квадрат со знаком NEXUS ───────────────────
# Заливка плитки: лавандовый налёт, светлее сверху — как у бренд-орба.
convert -size 344x344 gradient:'#2a2536'-'#131118' g-tgrad.png
convert -size 344x344 xc:black -fill white -draw 'roundrectangle 0,0 343,343 44,44' g-tmask.png
convert g-tgrad.png g-tmask.png -compose DstIn -composite -alpha set -channel A -evaluate multiply 0.4 +channel g-tfill.png
convert g-tfill.png -fill none -stroke 'rgba(198,182,251,0.18)' -strokewidth 1 \
  -draw 'roundrectangle 0,0 343,343 44,44' g-tile1.png

# Орбитальное кольцо внутри плитки и точка-спутник на нём.
convert g-tile1.png \
  -draw "stroke 'rgba(198,182,251,0.12)' stroke-width 1.2 fill none circle 172,172 172,54" \
  g-tile2.png
convert g-tile2.png \
  -fill 'rgba(198,182,251,0.45)' -stroke none -draw "circle 255.4,88.6 255.4,97.6" \
  -blur 0x2 g-tile3.png
convert g-tile3.png \
  -fill "$LAV" -stroke none -draw "circle 255.4,88.6 255.4,93.1" \
  g-tile4.png

# Лента знака: сначала глубокая тень со сдвигом (как ribbon-shadow в коде),
# затем сама лента с градиентом, и светящееся ядро в перекрестье.
#
# Координаты ленты пересчитаны в пиксели заранее. Нельзя рисовать её через
# `translate/scale` внутри -draw: в ImageMagick 6 штрих такой ломаной при
# этом начинает заливать внутренности, и вместо знака выходила сплошная
# клякса — из-за этого логотип на старой карточке и выглядел плохо.
# В финальных координатах штрих любой толщины чистый.
RIBBON='M70.6 198v-52l39-39 62.4 67.6 62.4-67.6 39 39v52l-39 39-62.4-67.6-62.4 67.6-39-39Z'
# Та же лента, сдвинутая на 9px вниз — для тени.
RIBBON_SHADOW='M70.6 207v-52l39-39 62.4 67.6 62.4-67.6 39 39v52l-39 39-62.4-67.6-62.4 67.6-39-39Z'

convert -size 344x344 xc:none \
  -stroke 'rgba(146,129,203,0.55)' -strokewidth 12 -fill none \
  -draw "stroke-linejoin round stroke-linecap round path '$RIBBON_SHADOW'" \
  -blur 0x6 g-ribbon-shadow.png

convert -size 344x344 xc:none \
  -stroke white -strokewidth 12 -fill none \
  -draw "stroke-linejoin round stroke-linecap round path '$RIBBON'" \
  g-ribbon-mask.png

# Градиентная лента: градиент обрезается по маске.
convert -size 344x344 gradient:"$LAV"-"$DEEP" g-ribbon-mask.png \
  -compose CopyOpacity -composite g-ribbon.png

convert g-tile4.png g-ribbon-shadow.png -composite g-ribbon.png -composite \
  -fill 'rgba(255,255,255,0.25)' -stroke none -draw "circle 172,166.8 172,184.8" \
  -blur 0x4 g-tile5.png
convert g-tile5.png \
  -fill '#f3efff' -stroke none -draw "circle 172,166.8 172,176.8" \
  g-tile6.png

# Подпись под знаком внутри плитки — как «NETWORK CONTROL» в боковой панели.
convert g-tile6.png -gravity Center -font "$F_MONO" -pointsize 10 -kerning 3 \
  -fill "$DIM" -annotate +0+132 'NETWORK CONTROL' g-tile.png

# ── Шапка слева ────────────────────────────────────────────────────────────
convert -size 84x30 xc:none \
  -fill 'rgba(198,182,251,0.12)' -stroke 'rgba(198,182,251,0.35)' -strokewidth 1 \
  -draw 'roundrectangle 0,0 83,29 9,9' g-vbadge.png

convert g-bg5.png g-tile.png -geometry +830+100 -composite \
  -font "$F_GROT" -pointsize 30 -kerning 4 -fill "$INK" -annotate +88+116 'NEXUS' \
  g-vbadge.png -geometry +224+92 -composite \
  -font "$F_MONO" -pointsize 13 -fill "$LAV" -annotate +242+113 'v1.6.0' \
  -font "$F_REG" -pointsize 15 -fill "$DIM" -annotate +88+146 'сетевые инструменты для Windows' \
  g-head.png

# Акцентная полоска: светлая лаванда перетекает в глубокую.
convert -size 56x3 gradient:"$LAV"-"$DEEP" g-stripe.png
convert g-head.png g-stripe.png -geometry +88+172 -composite g-head2.png

# Кикер с квадратиком-маркером, как служебные подписи в интерфейсе.
convert g-head2.png \
  -draw "fill '$LAV' roundrectangle 88,196 94,202 2,2" \
  -font "$F_MONO" -pointsize 11 -kerning 3 -fill "$LAV" -annotate +104+206 'БОЛЬШОЕ ОБНОВЛЕНИЕ' \
  g-head3.png

# ── Заголовок: первая строка белая, вторая — градиентная лаванда ──────────
convert -size 760x70 xc:none -font "$F_BOLD" -pointsize 54 -fill white \
  -annotate +0+53 'и надёжнее' g-h1b-mask.png
convert -size 760x70 gradient:'#d6c8fc'-'#8b76e4' g-h1b-mask.png \
  -compose CopyOpacity -composite g-h1b.png

convert g-head3.png \
  -font "$F_BOLD" -pointsize 54 -fill "$INK" -annotate +88+280 'Красивее, быстрее' \
  g-h1b.png -geometry +88+287 -composite \
  -font "$F_REG" -pointsize 16 -fill "$MUT" -annotate +88+380 'пять версий с прошлого поста — коротко о главном' \
  g-title.png

# ── Карточки изменений 2x2: плитки со значками как на «Обзоре» ────────────
convert -size 316x100 xc:none \
  -fill 'rgba(198,182,251,0.05)' -stroke 'rgba(198,182,251,0.13)' -strokewidth 1 \
  -draw 'roundrectangle 0,0 315,99 18,18' g-fcard.png

icon() { # icon <файл> <glyph-draw...> — плитка 42x42 с нарисованным значком
  local out="$1"; shift
  convert -size 42x42 xc:none \
    -fill 'rgba(198,182,251,0.10)' -stroke 'rgba(198,182,251,0.24)' -strokewidth 1 \
    -draw 'roundrectangle 0,0 41,41 12,12' \
    -stroke "$LAV" -strokewidth 2.2 -fill none -draw "stroke-linejoin round stroke-linecap round $*" \
    "$out"
}

# Искра — новое оформление
icon g-i1.png "path 'M21 11.5 L23.4 16.6 L28.5 19 L23.4 21.4 L21 26.5 L18.6 21.4 L13.5 19 L18.6 16.6 Z'"
convert g-i1.png -fill "$LAV" -stroke none -draw "circle 30.5,30.5 30.5,31.8" g-i1.png
# Молния — скорость
icon g-i2.png "path 'M23.5 3.5 L8.5 22.5 L15.5 22.5 L13 37.5 L28.5 17.5 L21 17.5 Z'"
# Щит с галочкой — надёжность
icon g-i3.png "path 'M21 4.5 L31 8.5 L31 15 C31 21.8 26.8 27 21 29.3 C15.2 27 11 21.8 11 15 L11 8.5 Z' path 'M16.5 20.5 L19.5 23.5 L26.5 16.5'"
# Кольца — оживший экран запуска
icon g-i4.png "circle 21,21 21,9.5 circle 21,21 21,14.5"
convert g-i4.png -fill "$LAV" -stroke none -draw "circle 21,21 21,23.4" g-i4.png

convert g-title.png \
  g-fcard.png -geometry +88+416 -composite \
  g-fcard.png -geometry +424+416 -composite \
  g-fcard.png -geometry +88+528 -composite \
  g-fcard.png -geometry +424+528 -composite \
  g-i1.png -geometry +106+434 -composite \
  g-i2.png -geometry +442+434 -composite \
  g-i3.png -geometry +106+546 -composite \
  g-i4.png -geometry +442+546 -composite \
  g-grid.png

convert g-grid.png \
  -font "$F_SEMI" -pointsize 17 -fill "$INK" \
    -annotate +162+454 'Оформление «Графит»' \
    -annotate +498+454 'Стало быстрее' \
    -annotate +162+566 'Автозапуск надёжнее' \
    -annotate +498+566 'Экран запуска ожил' \
  -font "$F_REG" -pointsize 12.2 -fill "$MUT" \
    -annotate +162+478 'графит и лаванда, светящаяся пыль' \
    -annotate +498+478 'список не тормозит, меню плавное' \
    -annotate +162+590 'модули поднимаются сами, без рук' \
    -annotate +498+590 'знак NEXUS с огоньками и кольцами' \
  -font "$F_MONO" -pointsize 10 -fill "$DIM" \
    -annotate +368+440 '01' \
    -annotate +704+440 '02' \
    -annotate +368+552 '03' \
    -annotate +704+552 '04' \
  g-body.png

# ── Панель обновления: шаги как пилюли ────────────────────────────────────
convert -size 344x140 xc:none \
  -fill 'rgba(198,182,251,0.05)' -stroke 'rgba(198,182,251,0.12)' -strokewidth 1 \
  -draw 'roundrectangle 0,0 343,139 20,20' g-panel.png

convert -size 106x34 xc:none \
  -fill 'rgba(198,182,251,0.07)' -stroke 'rgba(198,182,251,0.25)' -strokewidth 1 \
  -draw 'roundrectangle 0,0 105,33 10,10' g-pill.png
convert -size 86x34 gradient:"$LAV"-"$DEEP" g-pillgrad.png
convert -size 86x34 xc:black -fill white -draw 'roundrectangle 0,0 85,33 10,10' g-pillmask.png
convert g-pillgrad.png g-pillmask.png -compose DstIn -composite \
  -fill none -stroke 'rgba(255,255,255,0.28)' -strokewidth 1 \
  -draw 'roundrectangle 0,0 85,33 10,10' g-pill3.png

convert g-body.png \
  g-panel.png -geometry +830+468 -composite \
  g-pill.png -geometry +849+524 -composite \
  g-pill.png -geometry +963+524 -composite \
  g-pill3.png -geometry +1069+524 -composite \
  g-updates.png

convert g-updates.png \
  -font "$F_SEMI" -pointsize 17 -fill "$INK" -annotate +858+504 'Обновление в один клик' \
  -font "$F_SEMI" -pointsize 13 -fill "$INK" \
    -annotate +866+547 'О программе' \
    -annotate +983+547 'Проверить' \
  -font "$F_SEMI" -pointsize 13 -fill '#14121c' -annotate +1089+547 'Скачать' \
  -font "$F_REG" -pointsize 12 -fill "$MUT" -annotate +858+590 'дальше NEXUS обновится и запустится сам' \
  -draw "fill '$LAV' polygon 955,536 962,541 955,546" \
  -draw "fill '$LAV' polygon 1061,536 1068,541 1061,546" \
  g-body2.png

# ── Подвал: разделитель, пилюли-ссылки и условия ──────────────────────────
convert -size 196x36 xc:none \
  -fill 'rgba(198,182,251,0.07)' -stroke 'rgba(198,182,251,0.26)' -strokewidth 1 \
  -draw 'roundrectangle 0,0 195,35 10,10' g-pillA.png
convert -size 330x36 xc:none \
  -fill 'rgba(198,182,251,0.07)' -stroke 'rgba(198,182,251,0.26)' -strokewidth 1 \
  -draw 'roundrectangle 0,0 329,35 10,10' g-pillB.png

convert g-body2.png \
  -draw "fill 'rgba(255,255,255,0.08)' rectangle 84,646 1196,647" \
  g-pillA.png -geometry +88+664 -composite \
  g-pillB.png -geometry +302+664 -composite \
  g-foot.png

convert g-foot.png \
  -font "$F_MONO" -pointsize 16 -fill "$LAV" -annotate +104+689 '@' \
  -font "$F_MONO" -pointsize 13.5 -fill "$LAV" -annotate +126+688 't.me/nexus_flex' \
  -draw "fill '$LAV' polygon 311,674 324,674 317.5,687" \
  -font "$F_MONO" -pointsize 12.5 -fill "$LAV" -annotate +334+688 'github.com/folyaken/NEXUS-releases' \
  g-foot2.png

convert g-foot2.png -gravity SouthEast -font "$F_REG" -pointsize 12.5 -fill "$DIM" \
  -annotate +88+33 'Windows 10 / 11 · 64-bit · бесплатно' g-card.png

convert g-card.png -depth 8 -strip "$OUT"
echo "карточка «Графит» готова: $OUT"
