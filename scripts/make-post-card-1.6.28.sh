#!/usr/bin/env bash
# Карточка релиза NEXUS 1.6.28 для Telegram (1280x720).
#
# Отдельное оформление этого выпуска: знак NEXUS — большой, во всю правую
# часть и уходит за край кадра, как свет из окна; слева — путь из трёх главных
# изменений с нумерованными точками на общей линии. Никаких плиток и заголовка
# в три строки: выпуску после двадцати одной версии нужен не перечень, а знак
# и три вещи, ради которых стоит обновиться.
#
# Стрелки и типографские значки рисуются фигурами, а не текстом: в шрифтах
# приложения нарезаны только кириллица и латиница.
#
# Использование:  bash scripts/make-post-card-1.6.28.sh [путь-к-png]
set -e

OUT="${1:-brand/posts/card-1.6.28.png}"
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
LAV='#c6b6fb'       # светлая лаванда
DEEP='#7a63e0'      # глубокая лаванда

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

instance('space-grotesk-latin-wght-normal.woff2', 700, f'{fonts_dir}/SpaceGrotesk-Bold.ttf')
PYEOF
fi

cd /tmp
rm -f n-*.png

# ── Фон: глубокий графит, дыхание света за знаком, пыль ───────────────────
convert -size 900x900 radial-gradient:"$DEEP"-none -alpha set -channel A -evaluate multiply 0.20 +channel n-glowA.png
convert -size 820x820 radial-gradient:'#4b3a9e'-none -alpha set -channel A -evaluate multiply 0.16 +channel n-glowB.png
convert -size ${W}x${H} xc:"$BG" \
  n-glowA.png -geometry +530-130 -composite \
  n-glowB.png -geometry -280+220 -composite \
  n-bg1.png

# Диагонали в правом верхнем углу — тот же мотив, что у интерфейса.
convert -size ${W}x${H} xc:none \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 980,0 1280,300" \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 1060,0 1280,220" \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 900,0 1280,380" \
  -alpha set -channel A -evaluate multiply 0.04 +channel n-lines.png
convert n-bg1.png n-lines.png -composite n-bg2.png

# Орбиты вокруг знака: широкое кольцо и внешний контур, оба уходят за кадр.
convert n-bg2.png \
  -draw "stroke 'rgba(198,182,251,0.060)' stroke-width 1 fill none circle 980,320 980,20" \
  -draw "stroke 'rgba(198,182,251,0.035)' stroke-width 1 fill none circle 980,320 1340,320" \
  n-bg3.png

# Пыль — фирменная черта живого фона «Графита».
convert -size ${W}x${H} xc:none \
  -fill 'rgba(198,182,251,0.26)' -draw "circle 640,180 640,182" \
  -fill 'rgba(198,182,251,0.18)' -draw "circle 760,520 760,522" \
  -fill 'rgba(198,182,251,0.22)' -draw "circle 1150,628 1150,630" \
  -fill 'rgba(198,182,251,0.20)' -draw "circle 1240,90 1240,92" \
  -fill 'rgba(198,182,251,0.16)' -draw "circle 60,120 60,122" \
  -fill 'rgba(198,182,251,0.22)' -draw "circle 60,410 60,413" \
  -fill 'rgba(198,182,251,0.16)' -draw "circle 300,690 300,692" \
  -fill 'rgba(198,182,251,0.24)' -draw "circle 560,80 560,82" \
  -fill 'rgba(198,182,251,0.18)' -draw "circle 84,646 84,649" \
  -blur 0x2.5 n-dust.png
convert n-bg3.png n-dust.png -composite n-bg.png

# ── Знак NEXUS: большая лента через всю правую часть ──────────────────────
# Форма — та же лента, что в интерфейсе (два шестиугольника, сходящиеся в
# перекрестье). Координаты — исходный контур приложения, увеличенный вчетверо
# и сдвинутый: центр знака в точке (980, 320), правый край уходит за кадр.
# Лента рисуется линией (не заливкой): заливка ломаной в ImageMagick 6
# схлопывает перекрестье в кляксу.
RIBBON='M574.4 424 L574.4 216 L730.4 60 L980 330.4 L1229.6 60 L1385.6 216 L1385.6 424 L1229.6 580 L980 309.6 L730.4 580 Z'

# Свечение под лентой: широкая размытая та же линия.
convert -size ${W}x${H} xc:none \
  -stroke 'rgba(122,99,224,0.30)' -strokewidth 110 -fill none \
  -draw "stroke-linejoin round stroke-linecap round path '$RIBBON'" \
  -blur 0x26 n-ribbon-halo.png

# Маска ленты и её градиентная заливка.
convert -size ${W}x${H} xc:none \
  -stroke white -strokewidth 56 -fill none \
  -draw "stroke-linejoin round stroke-linecap round path '$RIBBON'" \
  n-ribbon-mask.png
convert -size ${W}x${H} gradient:'#d9ccfd'-"$DEEP" n-ribbon-mask.png \
  -compose CopyOpacity -composite n-ribbon.png

# Тонкий световой контур поверх ленты — объём, как у знака на орбе.
convert -size ${W}x${H} xc:none \
  -stroke 'rgba(255,255,255,0.35)' -strokewidth 2 -fill none \
  -draw "stroke-linejoin round stroke-linecap round path '$RIBBON'" \
  n-ribbon-edge.png

# Спутник на орбите — точка с кольцом, как в боковой панели.
convert n-bg.png \
  n-ribbon-halo.png -composite \
  n-ribbon.png -composite \
  n-ribbon-edge.png -composite \
  -draw "stroke 'rgba(198,182,251,0.35)' stroke-width 1 fill none circle 1210,127 1210,118" \
  -draw "fill '$LAV' circle 1210,127 1210,122.5" \
  -font "$F_MONO" -pointsize 10 -kerning 3 -fill "$DIM" -annotate +912+632 'NETWORK CONTROL' \
  -kerning 0 n-sign.png

# ── Шапка слева: имя, версия, девиз ───────────────────────────────────────
convert -size 86x28 xc:none \
  -fill 'rgba(198,182,251,0.14)' -stroke 'rgba(198,182,251,0.75)' -strokewidth 1 \
  -draw 'roundrectangle 0,0 85,27 9,9' n-vbadge.png

convert n-sign.png \
  -font "$F_GROT" -pointsize 30 -kerning 4 -fill "$INK" -annotate +88+116 'NEXUS' \
  n-vbadge.png -geometry +224+92 -composite \
  -font "$F_MONO" -pointsize 13 -kerning 0 -fill "$LAV" -annotate +246+110 'v1.6.28' \
  -font "$F_REG" -pointsize 15 -kerning 0 -fill "$DIM" -annotate +88+146 'сетевые инструменты для Windows' \
  n-head.png

convert -size 56x3 gradient:"$LAV"-"$DEEP" n-stripe.png
convert n-head.png n-stripe.png -geometry +88+172 -composite n-head2.png

# Кикер: двадцать одна версия после прошлого поста — повод для этой карточки.
convert n-head2.png \
  -draw "fill '$LAV' roundrectangle 88,196 94,202 2,2" \
  -font "$F_MONO" -pointsize 11 -kerning 3 -fill "$LAV" -annotate +104+206 '21 ВЕРСИЯ СПУСТЯ' \
  -kerning 0 n-head3.png

# ── Три главных изменения: путь с точками на одной линии ──────────────────
# Линия-путь и точки: точка выше — больше изменений не было. Номера
# выровнены по моноширинному шагу, подписи — по базовым линиям.
convert n-head3.png \
  -draw "fill 'rgba(198,182,251,0.20)' rectangle 99,262 100,524" \
  -draw "fill '$LAV' circle 100,294 100,290" \
  -draw "fill '$LAV' circle 100,386 100,382" \
  -draw "fill '$LAV' circle 100,478 100,474" \
  n-spine.png

convert n-spine.png \
  -font "$F_MONO" -pointsize 18 -fill "$DIM" \
    -annotate +124+300 '01' \
    -annotate +124+392 '02' \
    -annotate +124+484 '03' \
  -font "$F_SEMI" -pointsize 23 -fill "$INK" \
    -annotate +162+301 'Обход DPI больше не падает' \
    -annotate +162+393 '«Код 23» остался в прошлом' \
    -annotate +162+485 'Видно, куда ушёл трафик' \
  -font "$F_REG" -pointsize 12.5 -fill "$MUT" \
    -annotate +162+329 'списки создаёт сам, докачивает и повторяет запуск' \
    -annotate +162+421 'маршрутизация проверяется до подключения' \
    -annotate +162+513 'внешний IP и путь запроса — прямо в журнале' \
  n-rows.png

# ── Подвал: разделитель, две ссылки-пилюли и условия ──────────────────────
convert -size 196x36 xc:none \
  -fill 'rgba(198,182,251,0.07)' -stroke 'rgba(198,182,251,0.32)' -strokewidth 1 \
  -draw 'roundrectangle 0.5,0.5 195.5,35.5 10,10' n-pillA.png
convert -size 330x36 xc:none \
  -fill 'rgba(198,182,251,0.07)' -stroke 'rgba(198,182,251,0.32)' -strokewidth 1 \
  -draw 'roundrectangle 0.5,0.5 329.5,35.5 10,10' n-pillB.png

convert n-rows.png \
  -draw "fill 'rgba(255,255,255,0.08)' rectangle 84,646 1196,647" \
  n-pillA.png -geometry +88+664 -composite \
  n-pillB.png -geometry +302+664 -composite \
  n-foot.png

convert n-foot.png \
  -fill "$LAV" -stroke none -draw "circle 108,682 108,685.5" \
  -fill "$LAV" -stroke none -draw "circle 318,682 318,685.5" \
  -font "$F_MONO" -pointsize 13.5 -fill "$LAV" -annotate +122+686 't.me/nexus_flex' \
  -font "$F_MONO" -pointsize 12.5 -fill "$LAV" -annotate +336+686 'github.com/folyaken/NEXUS-releases' \
  n-foot2.png

convert n-foot2.png -gravity SouthEast -font "$F_REG" -pointsize 12.5 -fill "$DIM" \
  -annotate +88+33 'Windows 10 / 11 · 64-bit · бесплатно' n-card.png

convert n-card.png -depth 8 -strip "$OUT"
echo "карточка 1.6.28 готова: $OUT"
