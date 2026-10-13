#!/usr/bin/env bash
# Карточка релиза NEXUS 1.6.28 для Telegram (1280x720) — отдельное оформление.
#
# Это не шаблон прошлых карточек: другой характер у всего.
#   • палитра — «Багровое» из оформлений программы, а не графит с лавандой;
#   • композиция — гигантское число выпуска как главный элемент, справа
#     таблица из трёх главных изменений;
#   • знак NEXUS — маленькая марка в шапке и огромный полупрозрачный силуэт
#     на фоне; узор из линий, плитки, значки и пилюли прошлых карточек
#     не используются;
#   • подвал — одна строка по центру, а не пилюли-ссылки;
#   • плёночное зерно поверх фона — карточка читается как печатная.
#
# Стрелки и типографские значки рисуются фигурами: в шрифтах приложения
# нарезаны только кириллица и латиница.
#
# Использование:  bash scripts/make-post-card-1.6.28.sh [путь-к-png]
set -e

OUT="${1:-brand/posts/card-1.6.28-crimson.png}"
# Скрипт работает в /tmp, поэтому путь вывода сразу переводим в абсолютный.
case "$OUT" in
  /*) ;;
  *) OUT="$(pwd)/$OUT" ;;
esac

W=1280; H=720
BG='#0b0508'        # основа — «Багровое» из программы
INK='#f8f2f3'       # --text
MUT='#a9999d'       # --muted
DIM='#6d5d61'       # --muted-2
ACC='#e2596b'       # акцент темы
DEEP='#7e1f2f'      # глубокая багровая заливка
LIGHT='#ffd9df'     # светлый край градиента

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
rm -f c-*.png

# ── Фон: чёрно-багровый, два дыхания света ────────────────────────────────
convert -size 900x900 radial-gradient:"$DEEP"-none -alpha set -channel A -evaluate multiply 0.40 +channel c-glowA.png
convert -size 820x820 radial-gradient:'#49142a'-none -alpha set -channel A -evaluate multiply 0.34 +channel c-glowB.png
convert -size ${W}x${H} xc:"$BG" \
  c-glowA.png -geometry +520-380 -composite \
  c-glowB.png -geometry -300+380 -composite \
  c-bg1.png

# ── Знак NEXUS: большая полупрозрачная лента на фоне ──────────────────────
# Тот же контур, что в интерфейсе: два шестиугольника, сходящиеся в
# перекрестье. Координаты — исходный контур, умноженный на 2.4 относительно
# центра (930, 420): силуэт уходит за правый край и вниз. Это фоновая
# фактура, а не иллюстрация — поэтому только штрих и низкая плотность.
RIBBON='M686.6 482.4 L686.6 357.6 L780.2 264 L930 426.2 L1079.8 264 L1173.4 357.6 L1173.4 482.4 L1079.8 576 L930 413.8 L780.2 576 Z'

convert c-bg1.png \
  -stroke 'rgba(226,89,107,0.10)' -strokewidth 30 -fill none \
  -draw "stroke-linejoin round stroke-linecap round path '$RIBBON'" \
  c-bg2.png

# ── Плёночное зерно: карточка читается как печатная ───────────────────────
convert -size ${W}x${H} xc:gray50 +noise Gaussian \
  -alpha set -channel A -evaluate multiply 0.035 +channel c-grain.png
convert c-bg2.png c-grain.png -composite c-bg.png

# ── Шапка: марка знака слева, девиз справа, линия во всю ширину ───────────
# Марка рисуется на холсте 136x136 и уменьшается до 34x34: штрих выходит
# ровным и со сглаживанием, в отличие от рисования сразу в мелком размере.
MARK='M0 85.5 L0 50.6 L26.1 24.3 L68 69.7 L109.9 24.3 L136.1 50.6 L136.1 85.5 L109.9 111.7 L68 66.2 L26.1 111.7 Z'
convert -size 136x136 xc:none \
  -stroke "$ACC" -strokewidth 8 -fill none \
  -draw "stroke-linejoin round stroke-linecap round path '$MARK'" c-mark-big.png
convert c-mark-big.png -resize 34x34 c-mark.png

convert c-bg.png c-mark.png -geometry +88+58 -composite \
  -font "$F_GROT" -pointsize 26 -kerning 4 -fill "$INK" -annotate +134+92 'NEXUS' \
  -kerning 0 \
  -draw "fill 'rgba(255,255,255,0.07)' rectangle 88,118 1192,119" \
  -gravity NorthEast -font "$F_REG" -pointsize 13 -fill "$DIM" -annotate +88+80 'сетевые инструменты для Windows' \
  -gravity None c-head.png

# ── Кикер: что это за число ───────────────────────────────────────────────
convert c-head.png \
  -draw "fill '$ACC' roundrectangle 88,166 94,172 2,2" \
  -font "$F_MONO" -pointsize 12 -kerning 3 -fill "$ACC" -annotate +106+178 'ВЫПУСК · 21 ВЕРСИЯ СПУСТЯ' \
  -kerning 0 c-kick.png

# ── Число выпуска: главный элемент карточки ───────────────────────────────
# Текст рисуется белым по прозрачному холсту и обрезается по градиенту:
# заливка текста градиентом в ImageMagick 6 не работает напрямую.
convert -size 560x230 xc:none -font "$F_GROT" -pointsize 150 -fill white \
  -annotate +2+185 '1.6.28' c-num-mask.png
convert -size 560x230 gradient:"$LIGHT"-"$ACC" c-num-mask.png \
  -compose CopyOpacity -composite c-num.png

convert c-kick.png c-num.png -geometry +84+168 -composite \
  -font "$F_SEMI" -pointsize 24 -fill "$INK" -annotate +88+428 'Больше стабильности и ясности' \
  c-hero.png

# ── Три главных изменения: таблица справа, с линиями-разделителями ────────
# Линии отделяют строки друг от друга и замыкают таблицу сверху и снизу:
# получается список-манифест, а не абзацы текста.
convert c-hero.png \
  -draw "fill 'rgba(255,255,255,0.07)' rectangle 620,202 1192,203" \
  -draw "fill 'rgba(255,255,255,0.07)' rectangle 620,270 1192,271" \
  -draw "fill 'rgba(255,255,255,0.07)' rectangle 620,358 1192,359" \
  -draw "fill 'rgba(255,255,255,0.07)' rectangle 620,446 1192,447" \
  c-rules.png

convert c-rules.png \
  -font "$F_MONO" -pointsize 15 -fill "$DIM" \
    -annotate +620+240 '01' \
    -annotate +620+328 '02' \
    -annotate +620+416 '03' \
  -font "$F_SEMI" -pointsize 21 -fill "$INK" \
    -annotate +664+240 'Обход DPI больше не падает' \
    -annotate +664+328 '«Код 23» остался в прошлом' \
    -annotate +664+416 'Видно, куда ушёл трафик' \
  -font "$F_REG" -pointsize 12.5 -fill "$MUT" \
    -annotate +664+264 'списки создаёт сам, докачивает и повторяет запуск' \
    -annotate +664+352 'маршрутизация проверяется до подключения' \
    -annotate +664+440 'внешний IP и путь запроса — прямо в журнале' \
  c-body.png

# ── Подвал: линия и две строки по центру, без пилюль ──────────────────────
convert c-body.png \
  -draw "fill 'rgba(255,255,255,0.07)' rectangle 88,630 1192,631" \
  -gravity South \
  -font "$F_MONO" -pointsize 13 -fill "$ACC" -annotate +0+52 't.me/nexus_flex · github.com/folyaken/NEXUS-releases' \
  -font "$F_REG" -pointsize 11.5 -fill "$DIM" -annotate +0+24 'Windows 10 / 11 · 64-bit · бесплатно' \
  -gravity None c-card.png

convert c-card.png -depth 8 -strip "$OUT"
echo "карточка 1.6.28 готова: $OUT"
