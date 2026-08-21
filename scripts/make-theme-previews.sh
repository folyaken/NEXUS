#!/usr/bin/env bash
# Превью оформлений для поста: статические мини-интерфейсы 1280x720 и короткие
# зацикленные GIF (640x360, ~5 секунд) с живыми фонами тем.
#
# Всё рисуется ImageMagick'ом из тех же координат и цветов, что в коде тем:
# пыль «Графита», угли «Багрового» и пакеты «Индиго» повторяют реальный фон
# программы (для превью они чуть ярче, чтобы читались в маленьком кадре).
# Браузер для записи экрана в песочнице недоступен, поэтому превью собраны
# вручную — зато каждый кадр детерминированный и лёгкий.
#
# Использование: bash scripts/make-theme-previews.sh
set -e

OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/brand/posts"
cd /tmp
rm -f tp-*.png

# --- Цвета тем (из :root / сгенерированных тем) -----------------------------
palette() { # $1=тема $2=ключ
  case "$1" in
    indigo)
      case "$2" in
        bg) echo '#090d16' ;; panel) echo '#0e1420' ;; card) echo '#141c2b' ;;
        line) echo 'rgba(255,255,255,0.07)' ;; accent) echo '#7cf2d5' ;; accent2) echo '#a895ff' ;;
        text) echo '#edf2fb' ;; muted) echo '#8994a9' ;;
      esac ;;
    graphite)
      case "$2" in
        bg) echo '#0a090e' ;; panel) echo '#121017' ;; card) echo '#1a1720' ;;
        line) echo 'rgba(255,255,255,0.06)' ;; accent) echo '#c6b6fb' ;; accent2) echo '#7a63e0' ;;
        text) echo '#f3f2f6' ;; muted) echo '#a5a3ae' ;;
      esac ;;
    crimson)
      case "$2" in
        bg) echo '#0d0809' ;; panel) echo '#161011' ;; card) echo '#1c1315' ;;
        line) echo 'rgba(255,255,255,0.06)' ;; accent) echo '#d8505d' ;; accent2) echo '#e64248' ;;
        text) echo '#f7f1f2' ;; muted) echo '#b1a5a7' ;;
      esac ;;
  esac
}

# --- Статичный мини-интерфейс поверх фона -----------------------------------
# Макет намеренно оставляет широкие пустоты: в них живёт фон — как в самой
# программе, где между карточками видна подложка. Панели непрозрачные, как
# в приложении (устойчивость к захвату экрана).
draw_ui() { # $1=тема $2=S $3=выходной файл
  local th="$1" S="$2" out="$3"
  local bg pan card line ac ac2 text muted
  bg=$(palette "$th" bg); pan=$(palette "$th" panel); card=$(palette "$th" card)
  line=$(palette "$th" line); ac=$(palette "$th" accent); ac2=$(palette "$th" accent2)
  text=$(palette "$th" text); muted=$(palette "$th" muted)
  local W=$((640*S)) H=$((360*S))

  convert -size ${W}x${H} xc:none -draw "\
    fill '$pan' rectangle 0,0 $((96*S)),$H \
    fill rgba(255,255,255,0.04) rectangle $((96*S)),0 ${W},$((30*S)) \
    fill rgba(255,255,255,0.05) rectangle $((96*S)),$((30*S)) $((96*S+1)),$H \
    fill '$ac' fill-opacity 0.18 stroke '$ac' stroke-opacity 0.4 stroke-width 1 roundrectangle $((16*S)),$((20*S)) $((46*S)),$((50*S)) $((10*S)),$((10*S)) \
    fill '$ac' circle $((31*S)),$((35*S)) $((31*S)),$((40*S)) \
    fill '$text' fill-opacity 0.8 roundrectangle $((58*S)),$((26*S)) $((84*S)),$((33*S)) 2,2 \
    fill '$muted' fill-opacity 0.35 roundrectangle $((58*S)),$((38*S)) $((78*S)),$((43*S)) 2,2" \
    "$out"

  local y i
  for i in 0 1 2 3 4; do
    y=$((70*S + i*18*S))
    if [ "$i" = "0" ]; then
      convert "$out" -draw "\
        fill '$ac' fill-opacity 0.14 stroke '$ac' stroke-opacity 0.3 stroke-width 1 roundrectangle $((12*S)),$y $((84*S)),$((y+14*S)) $((7*S)),$((7*S)) \
        fill '$ac' rectangle $((12*S)),$((y+2*S)) $((14*S)),$((y+12*S)) \
        fill '$ac' circle $((26*S)),$((y+7*S)) $((26*S)),$((y+11*S)) \
        fill '$text' fill-opacity 0.75 roundrectangle $((38*S)),$((y+3*S)) $((66*S)),$((y+7*S)) 2,2" \
        "$out"
    else
      convert "$out" -draw "\
        fill '$muted' fill-opacity 0.3 circle $((26*S)),$((y+7*S)) $((26*S)),$((y+10*S)) \
        fill '$muted' fill-opacity 0.3 roundrectangle $((38*S)),$((y+3*S)) $((58*S)),$((y+7*S)) 2,2" \
        "$out"
    fi
  done

  # hero-карточка — до x=560, справа остаётся открытое поле для пакетов
  convert "$out" -draw "\
    fill '$card' stroke '$line' stroke-width 1 roundrectangle $((118*S)),$((48*S)) $((560*S)),$((140*S)) $((10*S)),$((10*S)) \
    fill '$ac' fill-opacity 0.8 roundrectangle $((140*S)),$((68*S)) $((210*S)),$((74*S)) 2,2 \
    fill '$text' fill-opacity 0.92 roundrectangle $((140*S)),$((84*S)) $((340*S)),$((96*S)) 2,2 \
    fill '$muted' fill-opacity 0.4 roundrectangle $((140*S)),$((104*S)) $((300*S)),$((111*S)) 2,2 \
    fill '$ac' roundrectangle $((140*S)),$((120*S)) $((216*S)),$((132*S)) $((6*S)),$((6*S)) \
    fill '$text' fill-opacity 0.8 roundrectangle $((152*S)),$((123*S)) $((204*S)),$((129*S)) 2,2" \
    "$out"

  # ряд статистики: 4 карточки с зазорами
  local cx
  for i in 0 1 2 3; do
    cx=$((118*S + i*112*S))
    convert "$out" -draw "\
      fill '$card' stroke '$line' stroke-width 1 roundrectangle $cx,$((160*S)) $((cx+100*S)),$((218*S)) $((8*S)),$((8*S)) \
      fill '$ac' fill-opacity 0.15 stroke '$ac' stroke-opacity 0.4 stroke-width 1 roundrectangle $((cx+10*S)),$((172*S)) $((cx+28*S)),$((190*S)) $((5*S)),$((5*S)) \
      fill '$ac' fill-opacity 0.8 circle $((cx+19*S)),$((181*S)) $((cx+19*S)),$((185*S)) \
      fill '$muted' fill-opacity 0.3 roundrectangle $((cx+38*S)),$((176*S)) $((cx+88*S)),$((181*S)) 2,2 \
      fill '$text' fill-opacity 0.8 roundrectangle $((cx+10*S)),$((200*S)) $((cx+62*S)),$((210*S)) 2,2" \
      "$out"
  done

  # строки-список
  local ry
  for i in 0 1 2 3; do
    ry=$((236*S + i*27*S))
    convert "$out" -draw "\
      fill '$card' stroke '$line' stroke-width 1 roundrectangle $((118*S)),$ry $((560*S)),$((ry+20*S)) $((8*S)),$((8*S)) \
      fill '$ac' fill-opacity 0.5 circle $((138*S)),$((ry+10*S)) $((138*S)),$((ry+14*S)) \
      fill '$muted' fill-opacity 0.4 roundrectangle $((154*S)),$((ry+6*S)) $((280*S)),$((ry+10*S)) 2,2" \
      "$out"
  done
}

# --- Живой фон: один кадр ----------------------------------------------------
# $1=тема $2=S $3=номер кадра $4=всего кадров. Координаты — в пространстве
# 640x360, умножаются на S. Яркость повышена против реального приложения:
# превью маленькое, и эффект обязан читаться.
bg_frame() {
  local th="$1" S="$2" t="$3" n="$4"
  local bg ac ac2
  bg=$(palette "$th" bg); ac=$(palette "$th" accent); ac2=$(palette "$th" accent2)
  local draw="fill '$bg' rectangle 0,0 $((640*S)),$((360*S))"

  case "$th" in
    indigo)
      draw="$draw $(awk -v t="$t" -v n="$n" -v S="$S" '
        BEGIN {
          pi = 3.14159265358979;
          ta = (9 + t * 47.0 / n) * pi / 180.0;
          tb = (-14 - t * 47.0 / n) * pi / 180.0;
          printf "fill #5e51d7 fill-opacity 0.12 circle %d,%d %d,%d ", 520*S, -30*S, 520*S, 240*S;
          printf "stroke rgba(124,242,213,0.13) stroke-width 1 fill none translate %d,%d rotate %.2f ellipse 0,0 %d,%d 0,360 ", 520*S, 190*S, ta*180/pi, 260*S, 160*S;
          xr = 260*S*cos(ta); yr = 160*S*sin(ta);
          printf "fill #7cf2d5 circle %d,%d %d,%d ", 520*S+xr, 190*S+yr, 520*S+xr, 190*S+yr+3*S;
          printf "stroke rgba(168,149,255,0.11) stroke-width 1 fill none translate %d,%d rotate %.2f ellipse 0,0 %d,%d 0,360 ", 300*S, 200*S, tb*180/pi, 230*S, 140*S;
          xb = 230*S*cos(tb); yb = 140*S*sin(tb);
          printf "fill #a895ff circle %d,%d %d,%d ", 300*S+xb, 200*S+yb, 300*S+xb, 200*S+yb+3*S;
          split("8,22 16,64 24,12 31,48 39,78 46,20 54,58 62,88 70,34 78,66 86,14 94,52", stars, " ");
          split("5.5 7 6 8 5 7.5 6.5 9 5.8 8.5 6.8 7.8", durs, " ");
          split("-2 -4 -1 -5 -3 -6 -2.5 -4.5 -1.5 -3.5 -5.5 -7", dels, " ");
          split("cyan violet mint cyan violet mint cyan violet mint cyan violet mint", cols, " ");
          for (i = 1; i <= 12; i++) {
            split(stars[i], xy, ",");
            phase = (t / n * 5.0 + dels[i] / durs[i]) * 2 * pi;
            op = 0.35 + 0.55 * (0.5 + 0.5 * sin(phase));
            c = (cols[i] == "cyan") ? "#7cf2d5" : (cols[i] == "violet") ? "#a895ff" : "#71f4b8";
            printf "fill %s fill-opacity %.2f circle %d,%d %d,%d ", c, op, xy[1]*6.4*S, xy[2]*3.6*S, xy[1]*6.4*S, xy[2]*3.6*S+1*S;
          }
          hx = 578*S; hy = 72*S;
          p1 = (t / n * 5.0 - 3.0/9.0) * 2 * pi; op1 = 0.5 + 0.5*sin(p1);
          if (op1 > 0.6) printf "stroke rgba(124,242,213,0.4) stroke-width 1 fill none line %d,%d %d,%d ", hx, hy, hx+20*S, hy+14*S;
          printf "fill #7cf2d5 fill-opacity %.2f circle %d,%d %d,%d ", 0.4+0.5*op1, hx+20*S, hy+14*S, hx+20*S, hy+14*S+1*S;
          printf "fill #a895ff fill-opacity 0.55 circle %d,%d %d,%d ", hx-24*S, hy+30*S, hx-24*S, hy+30*S+1*S;
          printf "fill #7cf2d5 circle %d,%d %d,%d", hx, hy, hx, hy+1*S;
        }')"
      ;;
    graphite)
      draw="$draw $(awk -v t="$t" -v n="$n" -v S="$S" '
        BEGIN {
          pi = 3.14159265358979;
          gx = sin(t / n * 2 * pi) * 25;
          printf "fill #7563c5 fill-opacity 0.14 circle %d,%d %d,%d ", (170+gx)*S, -40*S, (170+gx)*S, 220*S;
          printf "fill #4b3a9e fill-opacity 0.12 circle %d,%d %d,%d ", (520-gx)*S, 340*S, (520-gx)*S, 520*S;
          split("6,18 14,62 21,34 27,81 33,12 38,49 44,88 51,26 57,68 63,41 69,15 74,77 80,52 86,29 91,71 96,44 11,92 47,6", ms, " ");
          split("2 1 3 1 2 1 2 1 3 1 2 1 2 1 3 1 1 1", szs, " ");
          split("0 -7 -3 -11 -5 -14 -2 -9 -6 -13 -4 -10 -1 -8 -12 -15 -16 -18", ds, " ");
          for (i = 1; i <= 18; i++) {
            split(ms[i], xy, ",");
            elapsed = t / n * 5.0 + (-ds[i]);
            prog = elapsed / 22.0; prog -= int(prog);
            yoff = 14 - 40 * prog;
            op = 0;
            if (prog < 0.18) op = prog / 0.18 * 0.7;
            else if (prog < 0.5) op = 0.7 + (prog - 0.18) / 0.32 * 0.3;
            else if (prog < 0.82) op = 1.0 - (prog - 0.5) / 0.32 * 0.35;
            else op = 0.65 * (1 - (prog - 0.82) / 0.18);
            if (op <= 0.02) continue;
            r = (szs[i] + 1) * 0.8;
            printf "fill #c6b6fb fill-opacity %.2f circle %d,%d %d,%d ", op, xy[1]*6.4*S, (xy[2]*3.6 + yoff)*S, xy[1]*6.4*S, (xy[2]*3.6 + yoff)*S + r*S;
          }
        }')"
      ;;
    crimson)
      draw="$draw $(awk -v t="$t" -v n="$n" -v S="$S" '
        BEGIN {
          pi = 3.14159265358979;
          br = 0.7 + 0.3 * sin(t / n * 2 * pi * 2.4);
          printf "fill #d63c4a fill-opacity %.2f circle %d,%d %d,%d ", 0.22*br, 300*S, 350*S, 300*S, 520*S;
          printf "fill #e37242 fill-opacity %.2f circle %d,%d %d,%d ", 0.14*br, 560*S, 350*S, 560*S, 480*S;
          split("5 11 16 23 29 35 42 48 55 61 68 74 81 87 93 97", xs, " ");
          split("3 2 4 2 3 2 4 2 3 2 4 2 3 2 4 2", szs, " ");
          split("19 24 16 22 18 26 15 21 17 25 16 23 18 24 15 20", durs, " ");
          split("-2 -9 -5 -14 -1 -17 -7 -12 -4 -19 -8 -3 -15 -6 -11 -20", ds, " ");
          for (i = 1; i <= 16; i++) {
            elapsed = t / n * 5.0 + (-ds[i]);
            prog = elapsed / durs[i]; prog -= int(prog);
            y = 372 - prog * 402;
            op = 0;
            if (prog < 0.15) op = prog / 0.15;
            else if (prog < 0.85) op = 1.0;
            else op = 1.0 * (1 - (prog - 0.85) / 0.15);
            if (op <= 0.02) continue;
            xoff = 16 * (prog - 0.5) * 2;
            col = (i % 3 == 0) ? "#ff9a5c" : (i % 3 == 1) ? "#e64248" : "#ff7d5a";
            r = szs[i] * 0.8;
            printf "fill %s fill-opacity %.2f circle %d,%d %d,%d ", col, op, (xs[i]*6.4 + xoff)*S, y*S, (xs[i]*6.4 + xoff)*S, y*S + r*S;
          }
        }')"
      ;;
  esac
  echo "$draw"
}

# --- Сборка превью -----------------------------------------------------------
mkdir -p "$OUT_DIR"
N=50

for th in indigo graphite crimson; do
  draw_ui "$th" 1 /tmp/tp-ui-$th.png
  for t in $(seq 0 $((N-1))); do
    D=$(bg_frame "$th" 1 "$t" "$N")
    convert -size 640x360 xc:none -draw "$D" /tmp/tp-f-$th.png
    convert /tmp/tp-f-$th.png /tmp/tp-ui-$th.png -composite /tmp/tp-frame-$th-$t.png
  done
  convert -delay 10 -loop 0 /tmp/tp-frame-$th-*.png -layers Optimize -strip "$OUT_DIR/theme-preview-$th.gif"
  echo "GIF: $OUT_DIR/theme-preview-$th.gif ($(du -h "$OUT_DIR/theme-preview-$th.gif" | cut -f1))"

  draw_ui "$th" 2 /tmp/tp-ui2-$th.png
  D=$(bg_frame "$th" 2 10 "$N")
  convert -size 1280x720 xc:none -draw "$D" /tmp/tp-f2-$th.png
  convert /tmp/tp-f2-$th.png /tmp/tp-ui2-$th.png -composite -depth 8 -strip "$OUT_DIR/theme-mock-$th.png"
  echo "MOCK: $OUT_DIR/theme-mock-$th.png"
done
