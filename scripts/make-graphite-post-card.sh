#!/usr/bin/env bash
# Карточка релиза NEXUS для Telegram (1280x720), оформление «Графит».
#
# Цвета взяты из переменных темы (src/renderer/graphite.css): фон #0a090e,
# текст #f3f2f6, светлая лаванда #c6b6fb, глубокая #7a63e0, пятна фона — как
# в .app-shell, пыль — как в живом фоне темы. Карточка и программа выглядят
# одинаково.
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
LAV='#c6b6fb'       # светлая лаванда (текст, значки, тонкие линии)
DEEP='#7a63e0'      # глубокая лаванда (заливки, свечения)

F_BOLD=/tmp/fonts/Inter-Bold.ttf
F_SEMI=/tmp/fonts/Inter-Semi.ttf
F_REG=/tmp/fonts/Inter-Regular.ttf
F_MONO=/tmp/fonts/Mono-Medium.ttf

# ── Шрифты: если их ещё нет, нарезаются из шрифтов приложения ─────────────
if [ ! -f "$F_BOLD" ] || [ ! -f "$F_REG" ] || [ ! -f "$F_MONO" ]; then
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
PYEOF
fi

cd /tmp

# ── Фон: пятна как в .app-shell, диагонали и светящаяся пыль ───────────────
convert -size 900x900 radial-gradient:"$DEEP"-none -alpha set -channel A -evaluate multiply 0.22 +channel glowA.png
convert -size 820x820 radial-gradient:'#4b3a9e'-none -alpha set -channel A -evaluate multiply 0.18 +channel glowB.png
convert -size ${W}x${H} xc:"$BG" \
  glowA.png -geometry +560-420 -composite \
  glowB.png -geometry -260+440 -composite \
  bg1.png

convert -size ${W}x${H} xc:none \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 980,0 1280,300" \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 1060,0 1280,220" \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 900,0 1280,380" \
  -alpha set -channel A -evaluate multiply 0.04 +channel lines.png
convert bg1.png lines.png -composite bg2.png

# Пыль — отличительная черта живого фона «Графита»: редкие мягкие точки,
# плотнее вокруг логотипа и в нижней части.
convert -size ${W}x${H} xc:none \
  -fill 'rgba(198,182,251,0.30)' -draw "circle 84,646 84,649" \
  -fill 'rgba(198,182,251,0.22)' -draw "circle 152,700 152,702" \
  -fill 'rgba(198,182,251,0.34)' -draw "circle 218,636 218,640" \
  -fill 'rgba(198,182,251,0.20)' -draw "circle 302,694 302,696" \
  -fill 'rgba(198,182,251,0.28)' -draw "circle 371,660 371,663" \
  -fill 'rgba(198,182,251,0.18)' -draw "circle 452,706 452,708" \
  -fill 'rgba(198,182,251,0.26)' -draw "circle 528,648 528,651" \
  -fill 'rgba(198,182,251,0.16)' -draw "circle 610,690 610,692" \
  -fill 'rgba(198,182,251,0.30)' -draw "circle 668,622 668,625" \
  -fill 'rgba(198,182,251,0.22)' -draw "circle 706,676 706,678" \
  -fill 'rgba(198,182,251,0.26)' -draw "circle 60,300 60,303" \
  -fill 'rgba(198,182,251,0.16)' -draw "circle 740,120 740,122" \
  -fill 'rgba(198,182,251,0.30)' -draw "circle 726,214 726,217" \
  -fill 'rgba(198,182,251,0.24)' -draw "circle 758,342 758,345" \
  -fill 'rgba(198,182,251,0.34)' -draw "circle 1252,282 1252,286" \
  -fill 'rgba(198,182,251,0.22)' -draw "circle 1240,150 1240,152" \
  -fill 'rgba(198,182,251,0.28)' -draw "circle 1180,84 1180,87" \
  -fill 'rgba(198,182,251,0.20)' -draw "circle 1090,300 1090,302" \
  -fill 'rgba(198,182,251,0.26)' -draw "circle 1144,236 1144,239" \
  -fill 'rgba(198,182,251,0.18)' -draw "circle 1030,118 1030,120" \
  -fill 'rgba(198,182,251,0.24)' -draw "circle 896,470 896,472" \
  -fill 'rgba(198,182,251,0.20)' -draw "circle 790,520 790,522" \
  -fill 'rgba(198,182,251,0.26)' -draw "circle 84,470 84,473" \
  -fill 'rgba(198,182,251,0.18)' -draw "circle 40,540 40,542" \
  -fill 'rgba(198,182,251,0.22)' -draw "circle 950,70 950,72" \
  -blur 0x2.5 dust.png
convert bg2.png dust.png -composite bg3.png

# ── Логотип: знак бесконечности из интерфейса, в лаванде ─────────────────
convert -size 288x288 xc:none \
  -stroke "$DEEP" -strokewidth 6.5 -fill none \
  -draw "stroke-linejoin round stroke-linecap round translate 6,10 scale 12,12 path 'M4.2 14.2v-4l3-3 4.8 5.2 4.8-5.2 3 3v4l-3 3-4.8-5.2-4.8 5.2-3-3Z'" \
  -blur 0x9 logo-shadow.png
convert logo-shadow.png -alpha set -channel A -evaluate multiply 0.55 +channel logo-shadow.png

convert -size 288x288 xc:none \
  -fill 'rgba(198,182,251,0.55)' -draw "translate 6,6 scale 12,12 circle 12,11.8 12,13.1" \
  -blur 0x7 logo-core-glow.png

convert -size 288x288 xc:none \
  -stroke "$LAV" -strokewidth 3.4 -fill none \
  -draw "stroke-linejoin round stroke-linecap round translate 6,6 scale 12,12 path 'M4.2 14.2v-4l3-3 4.8 5.2 4.8-5.2 3 3v4l-3 3-4.8-5.2-4.8 5.2-3-3Z'" \
  -fill '#eae4ff' -stroke none \
  -draw "translate 6,6 scale 12,12 circle 12,11.8 12,12.8" \
  logo-face.png

convert -size 288x288 xc:none \
  logo-shadow.png -composite \
  logo-core-glow.png -composite \
  logo-face.png -composite \
  logo.png

# ── Свечение и кольца за логотипом ─────────────────────────────────────────
convert -size 560x560 radial-gradient:'rgba(122,99,224,0.34)'-none -alpha set -channel A -evaluate multiply 0.55 +channel lglow.png
convert -size ${W}x${H} xc:none \
  -stroke 'rgba(198,182,251,0.10)' -strokewidth 1 -fill none -draw "circle 992,250 992,400" \
  -stroke 'rgba(198,182,251,0.06)' -strokewidth 1 -fill none -draw "circle 992,250 992,446" \
  rings.png

convert bg3.png \
  lglow.png -geometry +712-30 -composite \
  rings.png -composite \
  logo.png -geometry +848+106 -composite \
  bg4.png

# ── Шапка ──────────────────────────────────────────────────────────────────
convert -size 92x30 xc:none \
  -draw "fill '#c6b6fb22' stroke '#c6b6fb59' stroke-width 1 roundrectangle 0,0 91,29 9,9" vbadge.png

convert bg4.png \
  -font "$F_BOLD" -pointsize 28 -fill "$INK" -annotate +88+114 'NEXUS' \
  vbadge.png -geometry +204+92 -composite \
  -font "$F_MONO" -pointsize 15 -fill "$LAV" -annotate +222+112 'v1.6.0' \
  -font "$F_REG"  -pointsize 17 -fill "$DIM" -annotate +88+146 'сетевые инструменты для Windows' \
  head.png

# Акцентная полоска: светлая лаванда перетекает в глубокую, как в интерфейсе
convert -size 60x3 gradient:"$LAV"-"$DEEP" stripe.png
convert head.png stripe.png -geometry +88+186 -composite head2.png

# ── Заголовок ──────────────────────────────────────────────────────────────
# Вторая строка набрана лавандой — в программе так же выделяется слово
# в главном заголовке «Обзора».
convert head2.png \
  -font "$F_BOLD" -pointsize 62 -fill "$INK" -annotate +88+258 'Красивее, быстрее' \
  -font "$F_BOLD" -pointsize 62 -fill "$LAV" -annotate +88+330 'и надёжнее' \
  -font "$F_REG"  -pointsize 19 -fill "$MUT" -annotate +88+372 'пять версий с прошлого поста — коротко о главном' \
  title.png

# ── Список изменений ───────────────────────────────────────────────────────
convert -size 620x66 xc:none \
  -draw "fill '#c6b6fb0d' stroke '#c6b6fb1f' stroke-width 1 roundrectangle 0,0 619,65 16,16" chip.png
convert -size 36x36 xc:none \
  -draw "fill '#c6b6fb1f' stroke '#c6b6fb4d' stroke-width 1 roundrectangle 0,0 35,35 11,11" badge.png

Y1=404; Y2=478; Y3=552; Y4=626
convert title.png \
  chip.png -geometry +88+${Y1} -composite \
  chip.png -geometry +88+${Y2} -composite \
  chip.png -geometry +88+${Y3} -composite \
  chip.png -geometry +88+${Y4} -composite \
  badge.png -geometry +110+$((Y1+15)) -composite \
  badge.png -geometry +110+$((Y2+15)) -composite \
  badge.png -geometry +110+$((Y3+15)) -composite \
  badge.png -geometry +110+$((Y4+15)) -composite \
  chips.png

convert chips.png \
  -font "$F_SEMI" -pointsize 21 -fill "$INK" \
    -annotate +166+$((Y1+27)) 'Оформление «Графит»' \
    -annotate +166+$((Y2+27)) 'Стало быстрее' \
    -annotate +166+$((Y3+27)) 'Автозапуск надёжнее' \
    -annotate +166+$((Y4+27)) 'Экран запуска ожил' \
  -font "$F_REG" -pointsize 15 -fill "$MUT" \
    -annotate +166+$((Y1+49)) 'графит и лаванда, светящаяся пыль на фоне' \
    -annotate +166+$((Y2+49)) 'список серверов не тормозит, меню переливается' \
    -annotate +166+$((Y3+49)) 'модули поднимаются сами, лишние процессы убираются' \
    -annotate +166+$((Y4+49)) 'знак NEXUS с огоньками, кольцами и плавными подписями' \
  -font "$F_MONO" -pointsize 15 -fill "$LAV" \
    -annotate +121+$((Y1+40)) '01' \
    -annotate +121+$((Y2+40)) '02' \
    -annotate +121+$((Y3+40)) '03' \
    -annotate +121+$((Y4+40)) '04' \
  list.png

# ── Подвал справа: обновление в один клик и контакты ──────────────────────
arrow() { # x y — маленький шеврон между шагами
  echo "fill '$LAV' polygon $1,$2 $(($1+7)),$(($2+5)) $1,$(($2+10)) $(($1+3)),$(($2+5))"
}

convert list.png \
  -font "$F_SEMI" -pointsize 19 -fill "$INK" -annotate +792+470 'Обновление в один клик' \
  -font "$F_REG"  -pointsize 15 -fill "$MUT" \
    -annotate +792+506 'О программе' \
    -annotate +928+506 'Проверить' \
    -annotate +1048+506 'Скачать' \
  -draw "$(arrow 902 495)" \
  -draw "$(arrow 1016 495)" \
  foot1.png

convert foot1.png \
  -draw "fill '#ffffff14' rectangle 792,534 1192,535" \
  foot2.png

# Метки перед ссылками: точка-пульс для канала, стрелка вниз для релизов
convert foot2.png \
  -stroke 'rgba(198,182,251,0.6)' -strokewidth 1.4 -fill none -draw "circle 800,570 800,578" \
  -fill "$LAV" -stroke none -draw "circle 800,570 800,572.6" \
  -fill "$LAV" -stroke none -draw "polygon 794,618 806,618 800,626" \
  -font "$F_REG" -pointsize 11 -fill "$DIM" \
    -annotate +792+556 'Канал в Telegram' \
    -annotate +792+602 'Все релизы и установщик' \
  -font "$F_MONO" -pointsize 17 -fill "$LAV" -annotate +812+578 't.me/nexus_flex' \
  -font "$F_MONO" -pointsize 15 -fill "$LAV" -annotate +812+632 'github.com/folyaken/NEXUS-releases' \
  -font "$F_REG" -pointsize 13 -fill "$DIM" -annotate +792+666 'Windows 10 / 11 · 64-bit · бесплатно' \
  card.png

convert card.png -depth 8 -strip "$OUT"
echo "карточка «Графит» готова: $OUT"
