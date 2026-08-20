#!/usr/bin/env bash
# Карточка-превью NEXUS для закреплённого поста (1280x720), оформление «Индиго».
#
# Цвета взяты из переменных интерфейса (:root в styles.css), поэтому карточка
# и программа выглядят одинаково. Значки чередуются бирюзовым и фиолетовым —
# как карточки на «Обзоре».
#
# Стрелки и типографские значки рисуются фигурами: в шрифтах приложения
# нарезаны только кириллица и латиница, остальное превращалось в пустоту.
set -e

W=1280; H=720
BG='#090d16'        # --bg
INK='#edf2fb'       # --text
MUT='#8994a9'       # --muted
DIM='#59657a'       # --muted-2
CY='#7cf2d5'        # --cyan
VI='#a895ff'        # --violet

F_BOLD=/tmp/fonts/Inter-Bold.ttf
F_SEMI=/tmp/fonts/Inter-Semi.ttf
F_REG=/tmp/fonts/Inter-Regular.ttf
F_MONO=/tmp/fonts/Mono-Medium.ttf

cd /tmp

# ── Фон: как .app-shell — холодные пятна по углам ──────────────────────────
convert -size 1000x1000 radial-gradient:'#5e51d7'-none -alpha set -channel A -evaluate multiply 0.30 +channel q-glowA.png
convert -size 820x820  radial-gradient:'#168f88'-none -alpha set -channel A -evaluate multiply 0.26 +channel q-glowB.png
convert -size ${W}x${H} xc:"$BG" \
  q-glowA.png -geometry -280-400 -composite \
  q-glowB.png -geometry +840+420 -composite \
  q-bg1.png

convert -size ${W}x${H} xc:none \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 0,470 380,90" \
  -draw "stroke '#ffffff' stroke-width 1 fill none line 0,560 470,90" \
  -alpha set -channel A -evaluate multiply 0.05 +channel q-lines.png
convert q-bg1.png q-lines.png -composite q-bg2.png

# ── Шапка ──────────────────────────────────────────────────────────────────
convert -size 300x300 radial-gradient:'#4de0a8'-none -alpha set -channel A -evaluate multiply 0.22 +channel q-lglow.png
convert /tmp/logo-indigo.png -resize 108x108 q-logo.png

convert q-bg2.png \
  q-lglow.png -geometry -8-30 -composite \
  q-logo.png -geometry +84+54 -composite \
  -font "$F_BOLD" -pointsize 52 -fill "$INK" -annotate +214+108 'NEXUS' \
  -font "$F_REG"  -pointsize 20 -fill "$MUT" -annotate +218+140 'сетевые инструменты для Windows' \
  q-head.png

# Полоска-акцент: бирюза переходит в фиолет, как в интерфейсе
convert q-head.png \
  -draw "fill '$CY' rectangle 84,192 114,195" \
  -draw "fill '$VI' rectangle 114,192 144,195" \
  q-head2.png

# ── Заголовок ──────────────────────────────────────────────────────────────
# «без блокировок» набрано бирюзой — в программе так же выделено слово
# в главном заголовке «Обзора».
convert q-head2.png \
  -font "$F_BOLD" -pointsize 40 -fill "$INK" -annotate +84+246 'Интернет' \
  -font "$F_BOLD" -pointsize 40 -fill "$CY"  -annotate +288+246 'без блокировок' \
  -font "$F_REG"  -pointsize 19 -fill "$MUT" -annotate +84+280 'Всё в одном окне. Без конфигов и командной строки.' \
  q-title.png

# ── Сетка возможностей ─────────────────────────────────────────────────────
convert -size 540x100 xc:none \
  -draw "fill '#ffffff0d' stroke '#ffffff14' stroke-width 1 roundrectangle 0,0 539,99 18,18" q-chip.png

CX1=84; CX2=656
R1=310; R2=424; R3=538

convert q-title.png \
  q-chip.png -geometry +${CX1}+${R1} -composite \
  q-chip.png -geometry +${CX2}+${R1} -composite \
  q-chip.png -geometry +${CX1}+${R2} -composite \
  q-chip.png -geometry +${CX2}+${R2} -composite \
  q-chip.png -geometry +${CX1}+${R3} -composite \
  q-chip.png -geometry +${CX2}+${R3} -composite \
  i-shield-cy.png  -geometry +$((CX1+28))+$((R1+28)) -composite \
  i-plane-vi.png   -geometry +$((CX2+28))+$((R1+28)) -composite \
  i-globe-cy.png   -geometry +$((CX1+28))+$((R2+28)) -composite \
  i-target-vi.png  -geometry +$((CX2+28))+$((R2+28)) -composite \
  i-share-cy.png   -geometry +$((CX1+28))+$((R3+28)) -composite \
  i-refresh-vi.png -geometry +$((CX2+28))+$((R3+28)) -composite \
  q-grid.png

convert q-grid.png \
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
  q-body.png

# ── Подвал: две ссылки + условия ───────────────────────────────────────────
# Стрелка загрузки рисуется фигурой, символа в шрифте нет.
arrow_down() { # x y
  echo "fill '$CY' polygon $1,$2 $(($1+10)),$2 $(($1+5)),$(($2+8))"
}

convert q-body.png \
  -draw "fill '#ffffff14' rectangle 84,678 1196,679" \
  -draw "$(arrow_down 84 700)" \
  -font "$F_MONO" -pointsize 15 -fill "$CY" -annotate +102+709 'github.com/folyaken/NEXUS-releases/releases' \
  -font "$F_MONO" -pointsize 15 -fill "$VI" -annotate +1060+709 't.me/nexus_flex' \
  q-foot.png

# Условия — строкой выше ссылок, чтобы низ не выглядел пустым
convert q-foot.png \
  -font "$F_REG" -pointsize 15 -fill "$DIM" \
    -annotate +84+664 'Windows 10 / 11 · 64-bit · бесплатно · ключи и настройки не покидают компьютер' \
  q-card.png

convert q-card.png -depth 8 -strip /tmp/preview-indigo.png
echo "превью «Индиго» готово"
