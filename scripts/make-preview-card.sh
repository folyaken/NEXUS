#!/usr/bin/env bash
# Карточка-превью NEXUS для закреплённого поста (1280x720).
#
# Задача другая, чем у карточки релиза: там «что нового», здесь — «что это
# за программа» для человека, который видит канал впервые. Поэтому сетка
# возможностей значками, а не список изменений.
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
convert -size 1000x1000 radial-gradient:'#7e1f2f'-none -alpha set -channel A -evaluate multiply 0.34 +channel pglowA.png
convert -size 760x760  radial-gradient:'#49142a'-none -alpha set -channel A -evaluate multiply 0.30 +channel pglowB.png
convert -size ${W}x${H} xc:"$BG" \
  pglowA.png -geometry -260-380 -composite \
  pglowB.png -geometry +820+400 -composite \
  p-bg1.png

convert -size ${W}x${H} xc:none \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 0,470 380,90" \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 0,560 470,90" \
  -alpha set -channel A -evaluate multiply 0.05 +channel p-lines.png
convert p-bg1.png p-lines.png -composite p-bg2.png

# ── Шапка: логотип слева, название рядом ───────────────────────────────────
convert -size 300x300 radial-gradient:'#c22f45'-none -alpha set -channel A -evaluate multiply 0.30 +channel p-lglow.png
convert /tmp/logo-final.png -resize 108x108 p-logo.png

convert p-bg2.png \
  p-lglow.png -geometry -8-30 -composite \
  p-logo.png -geometry +84+54 -composite \
  -font "$F_BOLD" -pointsize 52 -fill "$INK" -annotate +214+108 'NEXUS' \
  -font "$F_REG"  -pointsize 20 -fill "$MUT" -annotate +218+140 'сетевые инструменты для Windows' \
  p-head.png

# ── Подзаголовок-обещание ──────────────────────────────────────────────────
convert p-head.png -draw "fill '$ACC' rectangle 84,192 144,195" \
  -font "$F_BOLD" -pointsize 40 -fill "$INK" -annotate +84+246 'Интернет без блокировок' \
  -font "$F_REG"  -pointsize 19 -fill "$MUT" -annotate +84+280 'Всё в одном окне. Без конфигов и командной строки.' \
  p-title.png

# ── Сетка возможностей: 2 столбца по 3 ─────────────────────────────────────
convert -size 540x104 xc:none \
  -draw "fill '#ffffff0d' stroke '#ffffff12' stroke-width 1 roundrectangle 0,0 539,103 18,18" p-chip.png

CX1=84; CX2=656
R1=318; R2=436; R3=554

convert p-title.png \
  p-chip.png -geometry +${CX1}+${R1} -composite \
  p-chip.png -geometry +${CX2}+${R1} -composite \
  p-chip.png -geometry +${CX1}+${R2} -composite \
  p-chip.png -geometry +${CX2}+${R2} -composite \
  p-chip.png -geometry +${CX1}+${R3} -composite \
  p-chip.png -geometry +${CX2}+${R3} -composite \
  ic-shield.png  -geometry +$((CX1+28))+$((R1+28)) -composite \
  ic-plane.png   -geometry +$((CX2+28))+$((R1+28)) -composite \
  ic-globe.png   -geometry +$((CX1+28))+$((R2+28)) -composite \
  ic-target.png  -geometry +$((CX2+28))+$((R2+28)) -composite \
  ic-share.png   -geometry +$((CX1+28))+$((R3+28)) -composite \
  ic-refresh.png -geometry +$((CX2+28))+$((R3+28)) -composite \
  p-grid.png

convert p-grid.png \
  -font "$F_SEMI" -pointsize 20 -fill "$INK" \
    -annotate +$((CX1+96))+$((R1+44)) 'Обход блокировок' \
    -annotate +$((CX2+96))+$((R1+44)) 'Telegram работает' \
    -annotate +$((CX1+96))+$((R2+44)) 'VPN по вашей подписке' \
    -annotate +$((CX2+96))+$((R2+44)) 'Выбор программ' \
    -annotate +$((CX1+96))+$((R3+44)) 'Раздача в домашнюю сеть' \
    -annotate +$((CX2+96))+$((R3+44)) 'Обновление одной кнопкой' \
  -font "$F_REG" -pointsize 15 -fill "$MUT" \
    -annotate +$((CX1+96))+$((R1+70)) 'YouTube, Discord и другие сайты' \
    -annotate +$((CX2+96))+$((R1+70)) 'даже когда мессенджер закрыт' \
    -annotate +$((CX1+96))+$((R2+70)) 'VLESS, VMess, Trojan, Shadowsocks' \
    -annotate +$((CX2+96))+$((R2+70)) 'через VPN только то, что нужно' \
    -annotate +$((CX1+96))+$((R3+70)) 'телевизор, консоль, телефон' \
    -annotate +$((CX2+96))+$((R3+70)) 'скачает и установит само' \
  p-body.png

# ── Подвал ─────────────────────────────────────────────────────────────────
convert p-body.png \
  -draw "fill '#ffffff12' rectangle 84,668 1196,669" \
  -font "$F_MONO" -pointsize 14 -fill "$DIM" \
    -annotate +84+697 'Windows 10 / 11 · 64-bit · бесплатно · ключи не покидают компьютер' \
  -font "$F_MONO" -pointsize 14 -fill "$ACC" -annotate +1060+697 't.me/nexus_flex' \
  p-card.png

convert p-card.png -depth 8 -strip /tmp/preview-out.png
echo "превью готово"
