#!/usr/bin/env bash
# Значки для карточки-превью в оформлении «Индиго».
#
# Цвета берутся из переменных интерфейса: --cyan для левого столбца,
# --violet для правого. Так карточка совпадает с программой, где значки
# карточек тоже чередуются бирюзовым и фиолетовым.
set -e
CY='#7cf2d5'
VI='#a895ff'
S=48
cd /tmp

draw_set() { # draw_set <цвет> <суффикс>
  local A="$1"; local sfx="$2"

  convert -size ${S}x${S} xc:none \
    -draw "stroke '$A' stroke-width 2.6 fill none stroke-linejoin round path 'M 24,5 L 40,11 L 40,24 C 40,34 33,41 24,44 C 15,41 8,34 8,24 L 8,11 Z'" \
    -draw "stroke '$A' stroke-width 2.6 fill none stroke-linecap round path 'M 17,24 L 22,29 L 32,18'" \
    "/tmp/i-shield-${sfx}.png"

  convert -size ${S}x${S} xc:none \
    -draw "stroke '$A' stroke-width 2.6 fill none stroke-linejoin round path 'M 43,6 L 5,22 L 20,27 L 26,42 Z'" \
    -draw "stroke '$A' stroke-width 2.6 fill none stroke-linecap round path 'M 43,6 L 20,27'" \
    "/tmp/i-plane-${sfx}.png"

  convert -size ${S}x${S} xc:none \
    -draw "stroke '$A' stroke-width 2.6 fill none circle 24,24 24,4" \
    -draw "stroke '$A' stroke-width 2.6 fill none ellipse 24,24 9,20 0,360" \
    -draw "stroke '$A' stroke-width 2.6 fill none line 4,24 44,24" \
    "/tmp/i-globe-${sfx}.png"

  convert -size ${S}x${S} xc:none \
    -draw "stroke '$A' stroke-width 2.6 fill none circle 24,24 24,7" \
    -draw "stroke '$A' stroke-width 2.6 fill none circle 24,24 24,16" \
    -draw "fill '$A' circle 24,24 24,21" \
    -draw "stroke '$A' stroke-width 2.6 fill none stroke-linecap round line 24,2 24,8" \
    -draw "stroke '$A' stroke-width 2.6 fill none stroke-linecap round line 24,40 24,46" \
    -draw "stroke '$A' stroke-width 2.6 fill none stroke-linecap round line 2,24 8,24" \
    -draw "stroke '$A' stroke-width 2.6 fill none stroke-linecap round line 40,24 46,24" \
    "/tmp/i-target-${sfx}.png"

  convert -size ${S}x${S} xc:none \
    -draw "stroke '$A' stroke-width 2.6 fill none stroke-linejoin round roundrectangle 6,10 42,34 4,4" \
    -draw "stroke '$A' stroke-width 2.6 fill none stroke-linecap round line 18,41 30,41" \
    -draw "stroke '$A' stroke-width 2.6 fill none stroke-linecap round line 24,34 24,41" \
    -draw "stroke '$A' stroke-width 2.2 fill none arc 17,15 31,29 200,340" \
    -draw "fill '$A' circle 24,26 24,28" \
    "/tmp/i-share-${sfx}.png"

  convert -size ${S}x${S} xc:none \
    -draw "stroke '$A' stroke-width 2.8 fill none stroke-linecap round arc 8,8 40,40 40,330" \
    -draw "fill '$A' stroke none polygon 40,6 44,20 30,17" \
    "/tmp/i-refresh-${sfx}.png"
}

draw_set "$CY" cy
draw_set "$VI" vi
echo "значки «Индиго» готовы"
