#!/usr/bin/env bash
# Карточка релиза NEXUS для Telegram (1280x720).
#
# Стрелки «→» рисуются фигурами, а не текстом: в шрифтах приложения нарезаны
# только кириллица и латиница, типографские стрелки в подмножество не вошли и
# на карточке превращались в пустое место.
set -e

W=1280; H=720
BG='#090607'
INK='#f8f2f3'
MUT='#a9999d'
DIM='#6d5d61'
ACC='#e2596b'

F_BOLD=/tmp/fonts/Inter-Bold.ttf
F_SEMI=/tmp/fonts/Inter-Semi.ttf
F_REG=/tmp/fonts/Inter-Regular.ttf
F_MONO=/tmp/fonts/Mono-Medium.ttf

cd /tmp

# ── Фон ────────────────────────────────────────────────────────────────────
convert -size 900x900 radial-gradient:'#7e1f2f'-none -alpha set -channel A -evaluate multiply 0.42 +channel glowA.png
convert -size 720x720 radial-gradient:'#49142a'-none -alpha set -channel A -evaluate multiply 0.34 +channel glowB.png
convert -size ${W}x${H} xc:"$BG" \
  glowA.png -geometry +760-350 -composite \
  glowB.png -geometry -240+440 -composite \
  bg1.png

convert -size ${W}x${H} xc:none \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 980,0 1280,300" \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 1060,0 1280,220" \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 900,0 1280,380" \
  -alpha set -channel A -evaluate multiply 0.05 +channel lines.png
convert bg1.png lines.png -composite bg2.png

# ── Логотип ────────────────────────────────────────────────────────────────
convert -size 580x580 radial-gradient:'#c22f45'-none -alpha set -channel A -evaluate multiply 0.24 +channel lglow.png
convert /tmp/logo-final.png -resize 310x310 logo310.png
convert bg2.png \
  lglow.png -geometry +715+120 -composite \
  logo310.png -geometry +830+185 -composite \
  bg3.png

# ── Шапка ──────────────────────────────────────────────────────────────────
# Версия — отдельной плашкой, иначе она липнет к названию.
convert -size 92x30 xc:none \
  -draw "fill '#e2596b1f' stroke '#e2596b59' stroke-width 1 roundrectangle 0,0 91,29 9,9" vbadge.png

convert bg3.png \
  -font "$F_BOLD" -pointsize 28 -fill "$INK" -annotate +88+114 'NEXUS' \
  vbadge.png -geometry +204+92 -composite \
  -font "$F_MONO" -pointsize 15 -fill "$ACC" -annotate +222+112 'v1.4.5' \
  -font "$F_REG"  -pointsize 17 -fill "$DIM" -annotate +88+146 'сетевые инструменты для Windows' \
  head.png

convert head.png -draw "fill '$ACC' rectangle 88,186 148,189" head2.png

# ── Заголовок ──────────────────────────────────────────────────────────────
convert head2.png \
  -font "$F_BOLD" -pointsize 62 -fill "$INK" -annotate +88+256 'Большое обновление' \
  -font "$F_REG"  -pointsize 19 -fill "$MUT" -annotate +88+294 'девять версий с прошлого поста — коротко о главном' \
  title.png

# ── Список изменений ───────────────────────────────────────────────────────
convert -size 620x74 xc:none \
  -draw "fill '#ffffff10' stroke '#ffffff14' stroke-width 1 roundrectangle 0,0 619,73 16,16" chip.png
convert -size 38x38 xc:none \
  -draw "fill '#e2596b26' stroke '#e2596b66' stroke-width 1 roundrectangle 0,0 37,37 11,11" badge.png

Y1=336; Y2=426; Y3=516; Y4=606
convert title.png \
  chip.png -geometry +88+${Y1} -composite \
  chip.png -geometry +88+${Y2} -composite \
  chip.png -geometry +88+${Y3} -composite \
  chip.png -geometry +88+${Y4} -composite \
  badge.png -geometry +108+$((Y1+18)) -composite \
  badge.png -geometry +108+$((Y2+18)) -composite \
  badge.png -geometry +108+$((Y3+18)) -composite \
  badge.png -geometry +108+$((Y4+18)) -composite \
  chips.png

convert chips.png \
  -font "$F_SEMI" -pointsize 21 -fill "$INK" \
    -annotate +166+$((Y1+32)) 'Оформление «Багровое»' \
    -annotate +166+$((Y2+32)) 'Правила маршрутизации' \
    -annotate +166+$((Y3+32)) 'Проверка и подбор DNS' \
    -annotate +166+$((Y4+32)) 'Ошибка «код 23» исправлена' \
  -font "$F_REG" -pointsize 16 -fill "$MUT" \
    -annotate +166+$((Y1+56)) 'чёрное с красным, спокойное для глаз' \
    -annotate +166+$((Y2+56)) 'что через VPN, что напрямую, что закрыть' \
    -annotate +166+$((Y3+56)) 'NEXUS найдёт самый быстрый в вашей сети' \
    -annotate +166+$((Y4+56)) 'VPN снова подключается' \
  -font "$F_MONO" -pointsize 16 -fill "$ACC" \
    -annotate +119+$((Y1+42)) '01' \
    -annotate +119+$((Y2+42)) '02' \
    -annotate +119+$((Y3+42)) '03' \
    -annotate +119+$((Y4+42)) '04' \
  list.png

# ── Подвал справа ──────────────────────────────────────────────────────────
# Три шага обновления: подписи + нарисованные стрелки между ними.
arrow() { # x y  — маленький шеврон
  echo "fill '$ACC' polygon $1,$2 $(($1+7)),$(($2+5)) $1,$(($2+10)) $(($1+3)),$(($2+5))"
}

convert list.png \
  -font "$F_SEMI" -pointsize 19 -fill "$INK" -annotate +792+556 'Обновление в один клик' \
  -font "$F_REG"  -pointsize 15 -fill "$MUT" \
    -annotate +792+592 'О программе' \
    -annotate +928+592 'Проверить' \
    -annotate +1048+592 'Скачать' \
  -draw "$(arrow 900 581)" \
  -draw "$(arrow 1020 581)" \
  foot1.png

# Разделительная линия и контакты
convert foot1.png \
  -draw "fill '#ffffff14' rectangle 792,620 1192,621" \
  -font "$F_MONO" -pointsize 15 -fill "$ACC" -annotate +792+652 't.me/nexus_flex' \
  -font "$F_MONO" -pointsize 14 -fill "$DIM" -annotate +792+676 'Windows 10 / 11 · 64-bit' \
  card.png

convert card.png -depth 8 -strip /tmp/card-out.png
echo "готово"
