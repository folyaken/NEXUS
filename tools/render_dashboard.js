/* NEXUS welcome card = faithful reproduction of the real dashboard (App.tsx + styles.css).
   Renders the app window at 1280x720 using exact CSS values, fonts and icon paths. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const FD = path.join(__dirname, 'fonts');
const OUT = path.join(REPO, 'promo', 'nexus-card.png');
const TMP = '/tmp/nexus_dash';
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const F = {
  sgB: path.join(FD, 'SpaceGrotesk-Bold.ttf'),
  sgM: path.join(FD, 'SpaceGrotesk-Medium.ttf'),
  interR: path.join(FD, 'Inter-Regular.ttf'),
  interM: path.join(FD, 'Inter-Medium.ttf'),
  interSB: path.join(FD, 'Inter-SemiBold.ttf'),
  interB: path.join(FD, 'Inter-Bold.ttf'),
  interEB: path.join(FD, 'Inter-ExtraBold.ttf'),
  monoM: path.join(FD, 'JBMono-Medium.ttf'),
  monoB: path.join(FD, 'JBMono-Bold.ttf'),
};

const C = {
  bg: '#090d16', bar: '#17191f',
  sideTop: 'rgba(13,18,29,0.89)', sideBot: 'rgba(10,14,23,0.58)',
  text: '#edf2fb', head: '#eaf1fd', soft: '#d6deec', muted: '#8994a9', muted2: '#59657a',
  kicker: '#71809a', p: '#8a98ae', heroP: '#a2b0c4',
  cyan: '#7cf2d5', violet: '#a895ff', mint: '#71f4b8', amber: '#f8c76c', red: '#ff718f',
  line: 'rgba(255,255,255,0.07)',
  cardA: 'rgba(31,42,62,0.75)', cardB: 'rgba(19,26,40,0.72)',
  panel: 'rgba(21,29,44,0.59)',
};

const S = (v) => Math.round(v * 2);
const W = 2560, H = 1440;

function run(args, out) { execFileSync('convert', out ? args.concat(out) : args, { stdio: 'inherit' }); }
function sizeOf(f) { return execFileSync('identify', ['-format', '%w %h', f], { encoding: 'utf8' }).trim().split(/\s+/).map(Number); }
const tmp = (n) => path.join(TMP, n + '.png');
function over(base, layer, x, y, out) {
  run([base, '(', layer, ')', '-geometry', `+${S(x)}+${S(y)}`, '-composite', out || base]);
}
function gradRect(out, w, h, r, from, to) {
  const g = tmp('_gr'), m = tmp('_grm');
  run(['-size', `${S(w)}x${S(h)}`, `gradient:${from}-${to}`, g]);
  run(['-size', `${S(w)}x${S(h)}`, 'xc:black', '-fill', 'white',
    '-draw', `roundrectangle 0,0 ${S(w) - 1},${S(h) - 1} ${S(r)},${S(r)}`, m]);
  run([g, m, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', out]);
}
function gradText(out, label, font, size, from, to) {
  const mask = tmp('_tm'), grad = tmp('_tg');
  run(['-background', 'none', '-fill', 'white', '-font', font, '-pointsize', String(S(size)),
    '-gravity', 'center', `label:${label}`, mask]);
  const [w, h] = sizeOf(mask);
  run(['-size', `${w}x${h}`, `gradient:${from}-${to}`, grad]);
  run([grad, mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', out]);
  return [w, h];
}

let A = null;
const op = (...a) => A.push(...a);
function fill(c) { op('-fill', c); }
function stroke(c, w) { op('-stroke', c); if (w != null) op('-strokewidth', String(w)); }
function rrect(x, y, w, h, r) { op('-draw', `roundrectangle ${S(x)},${S(y)} ${S(x + w)},${S(y + h)} ${S(r)},${S(r)}`); }
function rect(x, y, w, h) { op('-draw', `rectangle ${S(x)},${S(y)} ${S(x + w)},${S(y + h)}`); }
function line(x1, y1, x2, y2) { op('-draw', `line ${S(x1)},${S(y1)} ${S(x2)},${S(y2)}`); }
function circle(cx, cy, rad) { op('-draw', `circle ${S(cx)},${S(cy)} ${S(cx + rad)},${S(cy)}`); }
function ellipse(cx, cy, rx, ry) { op('-draw', `ellipse ${S(cx)},${S(cy)} ${S(rx)},${S(ry)} 0,360`); }
function txt(x, y, size, a, b, str, kerning = 0) {
  const [font, color] = String(a).includes('.ttf') ? [a, b] : [b, a];
  fill(color);
  if (kerning) op('-kerning', String(kerning * 2));
  op('-font', font, '-pointsize', String(S(size)));
  op('-draw', `text ${S(x)},${S(y)} '${str.replace(/'/g, '')}'`);
  if (kerning) op('-kerning', '0');
}
function glyph(x, y, sizePx, color, strokeW, body) {
  stroke(color, strokeW * 2); op('-fill', 'none');
  op('-draw', `stroke-linecap round stroke-linejoin round translate ${S(x)},${S(y)} scale ${S(sizePx / 24)},${S(sizePx / 24)} ${body}`);
}
function flush(out) { run(A, out); }

/* icon paths from App.tsx (exact SVG d strings) */
const I = {
  nexus: `path 'M4.2 13.6v-4l3-3 4.8 5.2 4.8-5.2 3 3v4l-3 3-4.8-5.2-4.8 5.2-3-3Z'`,
  home: `path 'm4 10 8-6 8 6v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z'`,
  modules: `path 'M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z'`,
  jey: `path 'M12 5V2M12 22v-3M5 12H2M22 12h-3M7 7 5 5M19 19l-2-2M17 7l2-2M7 17l-2 2'`,
  logs: `path 'M5 5h14M5 12h14M5 19h9'`,
  about: `path 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v6M12 7.5v.1'`,
  gear: `path 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z'`,
  shield: `path 'M12 2l8 3v5c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z'`,
  diamond: `path 'M12 4l6.5 8L12 20l-6.5-8z'`,
  star4: `path 'M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z'`,
  zap: `path 'M13 2 4 14h6l-1 8 9-12h-6z'`,
  clock: `path 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2'`,
  infinity: `path 'M7 8c-2.2 0-4 1.8-4 4s1.8 4 4 4c2.2 0 3.6-1.4 5-4-1.4-2.6-2.8-4-5-4Zm10 0c-2.2 0-3.6 1.4-5 4 1.4 2.6 2.8 4 5 4 2.2 0 4-1.8 4-4s-1.8-4-4-4Z'`,
};

/* ================= build ================= */
const canvas = tmp('dash');
run(['-size', `${W}x${H}`, 'xc:' + C.bg, canvas]);

// app-shell ambient background
const amb = tmp('_amb');
run(['-size', `${W}x${H}`, 'xc:none', amb]);
run([amb, '-fill', 'rgba(115,92,244,0.12)',
  '-draw', `circle ${S(960)},${S(-80)} ${S(960 + 300)},${S(-80)}`, amb]);
run([amb, '-fill', 'rgba(51,177,170,0.08)',
  '-draw', `circle ${S(560)},${S(800)} ${S(560 + 300)},${S(800)}`, amb]);
run([amb, '-blur', '0x70', amb]);
over(canvas, amb, 0, 0, canvas);

/* ---- window bar (36px) ---- */
A = [canvas];
fill(C.bar); stroke('none'); rect(0, 0, 1280, 36);
stroke('rgba(255,255,255,0.07)', 2); line(0, 36, 1280, 36);
fill('rgba(124,242,213,0.1)'); stroke('rgba(124,242,213,0.3)', 2); rrect(13, 9, 18, 18, 6);
glyph(22, 18, 13, C.cyan, 1.5, I.nexus);
txt(40, 23, 10, F.sgB, '#cbd3df', 'NEXUS', 1.3);
txt(90, 23, 10, F.interR, '#8d96a8', '/');
txt(100, 23, 10, F.interR, '#8d96a8', 'Network Control Plane');
// window controls
stroke('#919baa', 2.5); line(1178, 18, 1194, 18);
stroke('#919baa', 2); op('-fill', 'none'); rrect(1203, 11, 15, 15, 1);
line(1225, 11, 1241, 27); line(1241, 11, 1225, 27);
flush(canvas);

/* ---- sidebar (254px, 36..720) ---- */
const sg = tmp('_side');
run(['-size', `${S(254)}x${S(684)}`, `gradient:${C.sideTop}-${C.sideBot}`, sg]);
over(canvas, sg, 0, 36, canvas);
A = [canvas];
stroke('rgba(255,255,255,0.07)', 2); line(254, 36, 254, 720);
// collapse button
fill('#151b26'); stroke('rgba(255,255,255,0.11)', 2); rrect(240, 63, 28, 28, 9);
stroke('#9aa7ba', 3); line(252, 71, 258, 77); line(258, 71, 252, 77);
// brand
fill('rgba(124,242,213,0.22)'); stroke('rgba(123,242,213,0.46)', 2); rrect(29, 66, 39, 39, 14);
op('-fill', 'none'); glyph(48.5, 85.5, 23, C.cyan, 1.5, I.nexus);
txt(80, 85, 17, F.sgB, C.text, 'NEXUS', 3.7);
txt(80, 99, 8, F.monoM, C.muted2, 'NETWORK CONTROL', 1.4);
// workspace selector
fill('rgba(255,255,255,0.035)'); stroke('rgba(255,255,255,0.07)', 2); rrect(23, 139, 208, 54, 17);
fill('rgba(130,236,213,1)'); stroke('none'); rrect(33, 149, 34, 34, 11);
txt(45, 171, 14, '#151b26', F.interEB, 'N');
txt(79, 160, 10, F.monoM, C.muted2, 'DEVICE PROFILE', 1.4);
txt(172, 160, 8, F.monoM, C.muted2, '· NX-LOCAL');
txt(79, 178, 13, F.interSB, '#d6deec', 'Локальное устройство');
fill('rgba(113,244,184,0.06)'); stroke('rgba(113,244,184,0.16)', 2); rrect(185, 152, 40, 22, 6);
txt(191, 168, 8, F.monoM, C.mint, 'LOCAL', 0.6);
// nav label
txt(33, 236, 10, F.monoM, C.muted2, 'CONTROL CENTER', 1.4);
// nav items
const nav = [
  { l: 'Обзор', icon: I.home, active: true },
  { l: 'Модули', icon: I.modules },
  { l: 'Jey2Ray', icon: I.jey },
  { l: 'Логи', icon: I.logs },
  { l: 'Настройки', icon: I.gear },
];
nav.forEach((it, i) => {
  const y = 248 + i * 46;
  if (it.active) {
    fill('rgba(115,229,202,0.14)'); stroke('rgba(124,242,213,0.1)', 2); rrect(18, y, 218, 46, 14);
    fill(C.cyan); stroke('none'); rect(0, y + 10, 3, 22);
    glyph(40, y + 23, 19, C.cyan, 1.6, it.icon);
    txt(60, y + 28, 14, '#eefcf9', F.interSB, it.l);
  } else {
    glyph(40, y + 23, 19, C.muted2, 1.6, it.icon);
    txt(60, y + 28, 14, C.muted, F.interM, it.l);
  }
});
// sidebar bottom (anchored to bottom)
const by = 636;
glyph(40, by + 21, 19, '#8f9caf', 1.6, I.about);
txt(60, by + 26, 14, '#aab4c4', F.interM, 'О программе');
fill('rgba(113,244,184,0.045)'); stroke('rgba(113,244,184,0.12)', 2); rrect(26, by + 42, 202, 50, 15);
fill(C.mint); stroke('none'); circle(40, by + 67, 4);
txt(54, by + 61, 12, '#d8f8e9', F.interB, 'Контур активен');
txt(54, by + 81, 10, '#708b86', F.interR, '1 запущено');
txt(28, 712, 9, '#4e5a70', F.monoM, 'NEXUS v1.1.9', 0.4);
fill(C.mint); stroke('none'); circle(206, 708, 3);
txt(212, 712, 9, '#4e5a70', F.monoM, 'LOCAL', 0.4);
flush(canvas);

/* ---- main content ---- */
const ML = 309, MR = 1225;   // content box (padding 0 55 from sidebar 254)
const CW = MR - ML;           // 916

/* hero */
A = [canvas];
gradRect(tmp('_hero'), CW, 298, 27, 'rgba(33,46,74,0.78)', 'rgba(52,45,101,0.48)');
over(canvas, tmp('_hero'), ML, 71, canvas);
// hero radial accent
const hg = tmp('_hg');
run(['-size', `${W}x${H}`, 'xc:none', hg]);
run([hg, '-fill', 'rgba(124,242,213,0.14)',
  '-draw', `circle ${S(MR - 150)},${S(150)} ${S(MR - 150 + 190)},${S(150)}`, hg]);
run([hg, '-blur', '0x60', hg]);
over(canvas, hg, 0, 0, canvas);
A = [canvas];
stroke('rgba(140,161,255,0.12)', 2); op('-fill', 'none'); rrect(ML, 71, CW, 298, 27);
// hero rings (after pseudo)
stroke('rgba(125,242,213,0.055)', 2); op('-fill', 'none');
circle(MR - 210, 71 + 150, 240);
stroke('rgba(125,242,213,0.03)', 2);
circle(MR - 210, 71 + 150, 274);
circle(MR - 210, 71 + 150, 308);
// kicker
const hx = ML + 44;
glyph(hx, 118, 14, C.cyan, 1.6, I.star4);
txt(hx + 13, 122, 10, '#8e9ec0', F.monoM, 'УПРАВЛЕНИЕ ЛОКАЛЬНОЙ СЕТЬЮ', 1.6);
stroke('rgba(124,242,213,0.45)', 2); line(hx + 252, 118, hx + 288, 118);
// h1
txt(hx, 176, 53, F.interEB, '#edf3ff', 'Сеть, которая');
const [ghw, ghh] = gradText(tmp('_h1'), 'остаётся под контролем.', F.interEB, 53, '#90e9da', '#aa9bff');
over(canvas, tmp('_h1'), hx, Math.round(238 - (ghh / 2) * 0.8), canvas);
// p
txt(hx, 286, 13, F.interR, C.heroP, 'Единый центр для спокойного управления сетевыми инструментами,');
txt(hx, 306, 13, F.interR, C.heroP, 'локальными прокси и профилями маршрутизации.');
flush(canvas);

// hero buttons
gradRect(tmp('_btn'), 180, 44, 13, '#83efd1', '#a993ff');
run(['-background', 'none', '-fill', '#121827', '-font', F.interEB, '-pointsize', String(S(12)),
  '-gravity', 'center', 'label:Открыть модули', tmp('_btnt')]);
run([tmp('_btn'), tmp('_btnt'), '-gravity', 'center', '-compose', 'over', '-composite', tmp('_btn')]);
fill('rgba(17,28,41,0.15)'); stroke('none');
// (square ↗ chip drawn after composite below)
over(canvas, tmp('_btn'), hx, 322, canvas);
A = [canvas];
fill('rgba(17,28,41,0.15)'); stroke('none'); rrect(hx + 150, 333, 22, 22, 8);
stroke('#121827', 3); op('-fill', 'none');
op('-draw', `stroke-linecap round stroke-linejoin round translate ${S(hx + 156)},${S(339)} scale ${S(11 / 24)},${S(11 / 24)} path 'M7 17 17 7M8 7h9v9'`);
glyph(hx + 208, 344, 16, C.cyan, 1.6, I.infinity);
txt(hx + 220, 349, 12, F.interM, '#a1aec2', 'Сканировать заново');
// hero visual orbits (right side)
const hvw = CW * 0.48, hvx = MR - hvw;
stroke('rgba(122,241,216,0.17)', 2); op('-fill', 'none');
ellipse(hvx + hvw * 0.58, 71 + 13 + 138, 138, 138);
stroke('rgba(168,149,255,0.22)', 2);
ellipse(hvx + hvw * 0.80, 71 + 60 + 69, 149, 69);
fill('rgba(124,242,213,0.15)'); stroke('rgba(142,240,218,0.31)', 2);
circle(hvx + hvw * 0.64, 71 + 88 + 63, 63);
op('-fill', 'none'); glyph(hvx + hvw * 0.64, 71 + 88 + 63, 40, C.cyan, 1.5, I.nexus);
fill('#dffbf5'); stroke('none');
circle(hvx + hvw * 0.58 - 90, 71 + 13 + 25, 2);
circle(hvx + hvw * 0.80 + 73, 71 + 60 + 9, 1.5);
txt(hvx + hvw - 128, 71 + 298 - 27, 9, F.monoM, '#6e7f9a', 'LIVE', 1);
fill(C.mint); stroke('none'); circle(hvx + hvw - 150, 71 + 298 - 31, 3);
txt(hvx + hvw - 236, 71 + 298 - 27, 9, F.monoM, '#6e7f9a', 'LOCAL / ENCRYPTED', 1);
flush(canvas);

/* stats */
A = [canvas];
const sy = 384, sh = 100, sgap = 13, sw = Math.floor((CW - sgap * 3) / 4);
const stats = [
  { l: 'ВСЕГО МОДУЛЕЙ', v: '04', n: 'обнаружено локально', g: I.diamond, c: C.cyan },
  { l: 'АКТИВНЫЕ', v: '01', n: 'контур запущен', g: I.zap, c: C.violet },
  { l: 'ЗДОРОВЬЕ', v: '100%', n: 'без критических ошибок', g: I.infinity, c: C.mint },
  { l: 'ПОСЛЕДНИЙ СКАН', v: '19:42', n: 'автозапуск включён', g: I.clock, c: C.amber },
];
stats.forEach((s, i) => {
  const x = ML + i * (sw + sgap);
  fill('rgba(21,29,44,0.59)'); stroke('rgba(255,255,255,0.07)', 2); rrect(x, sy, sw, sh, 18);
  const toneBg = { cyan: 'rgba(124,242,213,0.1)', violet: 'rgba(168,149,255,0.11)', mint: 'rgba(113,244,184,0.1)', amber: 'rgba(248,199,108,0.1)' };
  fill(toneBg[i === 0 ? 'cyan' : i === 1 ? 'violet' : i === 2 ? 'mint' : 'amber']); stroke('none');
  rrect(x + 17, sy + 30, 40, 40, 12);
  glyph(x + 37, sy + 50, 20, s.c, 1.6, s.g);
  txt(x + 70, sy + 44, 9, F.monoM, C.kicker, s.l, 0.9);
  txt(x + 70, sy + 72, 21, F.interB, '#ecf3ff', s.v);
  txt(x + 70, sy + 88, 10, F.interR, '#78869b', s.n);
});
flush(canvas);

/* section heading */
A = [canvas];
txt(ML, 541, 9, F.monoM, C.kicker, 'ВАШИ ИНСТРУМЕНТЫ', 1.8);
txt(ML, 566, 23, F.interB, '#e6edf9', 'Быстрый доступ');
txt(MR - 58, 564, 12, F.interM, '#9aa8bb', 'Все модули');
stroke(C.cyan, 3); op('-fill', 'none');
op('-draw', `stroke-linecap round stroke-linejoin round translate ${S(MR - 8)},${S(559)} scale ${S(13 / 24)},${S(13 / 24)} path 'M6 4l6 8-6 8'`);
flush(canvas);

/* dashboard grid: 2 module cards + pulse panel (top row, crops at bottom) */
A = [canvas];
const gy = 584, cardH = 218, leftW = Math.floor((CW - 15) * 1.75 / 2.65), pulseW = CW - 15 - leftW;
const cardW = Math.floor((leftW - 15) / 2);

function moduleCard(x, y, w, m) {
  gradRect(tmp('_mc'), w, cardH, 21, C.cardA, C.cardB);
  over(canvas, tmp('_mc'), x, y, canvas);
  A = [canvas];
  stroke('rgba(255,255,255,0.07)', 2); op('-fill', 'none'); rrect(x, y, w, cardH, 21);
  const running = m.status === 'running';
  const iconBg = { dpi: 'rgba(124,242,213,0.18)', proxy: 'rgba(168,149,255,0.18)' }[m.cat];
  const iconC = { dpi: C.cyan, proxy: C.violet }[m.cat];
  fill(iconBg); stroke('rgba(255,255,255,0.09)', 2); rrect(x + 18, y + 19, 42, 42, 13);
  glyph(x + 39, y + 40, 22, iconC, 1.6, m.g);
  fill('rgba(124,242,213,0.12)'); stroke('rgba(124,242,213,0.12)', 2);
  rrect(x + 72, y + 20, m.cat === 'dpi' ? 30 : 46, 16, 5);
  txt(x + 78, y + 32, 9, '#83aaac', F.monoM, m.cat.toUpperCase(), 0.7);
  fill(running ? C.mint : '#78849d'); stroke('none'); circle(x + m.cat === 'dpi' ? 112 : 128, y + 28, 4);
  txt(x + (m.cat === 'dpi' ? 120 : 136), y + 32, 10, running ? '#82e9bd' : '#9aa7ba', F.interR, running ? 'Активен' : 'Остановлен');
  txt(x + 72, y + 64, 17, F.interB, '#eaf1fc', m.name);
  // gear
  glyph(x + w - 90, y + 36, 15, '#8f9caf', 1.6, I.gear);
  // toggle
  const tx = x + w - 66, ty = y + 24;
  fill(running ? 'rgba(92,231,176,0.9)' : '#252d3c'); stroke('none');
  rrect(tx, ty, 48, 26, 13);
  const kx = running ? tx + 35 : tx + 13;
  fill(running ? '#f3fffa' : '#d6dbe6');
  circle(kx, ty + 13, 10);
  // strategy (zapret)
  if (m.strategy) {
    txt(x + 18, y + 96, 10, F.interR, '#8391a7', 'Профиль');
    fill('rgba(124,242,213,0.06)'); stroke('rgba(124,242,213,0.16)', 2);
    rrect(x + 62, y + 86, 145, 22, 8);
    txt(x + 70, y + 102, 10, F.interR, '#bfece1', m.strategy);
    txt(x + 214, y + 102, 10, F.interR, C.cyan, 'Изменить');
  }
  const descY = m.strategy ? y + 130 : y + 104;
  txt(x + 18, descY, 11, F.interR, '#a9b5c7', m.desc);
  stroke('rgba(255,255,255,0.06)', 2); line(x + 18, y + 172, x + w - 18, y + 172);
  fill('#718097'); stroke('none'); circle(x + 20, y + 197, 2.5);
  txt(x + 28, y + 200, 10, F.monoM, '#93a1b6', running ? `PID ${m.pid}` : 'Готов к запуску');
  txt(x + w - 18 - 92, y + 200, 11, F.interB, '#b1c0d1', running ? 'Остановить' : 'Запустить');
  stroke(C.cyan, 3); op('-fill', 'none');
  op('-draw', `stroke-linecap round stroke-linejoin round translate ${S(x + w - 18 - 12)},${S(y + 195)} scale ${S(11 / 24)},${S(11 / 24)} path 'M7 17 17 7M8 7h9v9'`);
  flush(canvas);
}

moduleCard(ML, gy, cardW, { name: 'Обход DPI', cat: 'dpi', g: I.shield, status: 'running', pid: 4812, strategy: 'general (ALT10)', desc: 'Открывает YouTube, Discord и другие сайты без VPN.' });
moduleCard(ML + cardW + 15, gy, cardW, { name: 'TG WS Proxy', cat: 'proxy', g: I.diamond, status: 'stopped', pid: null, strategy: null, desc: 'Возвращает доступ к Telegram, когда он заблокирован.' });

/* pulse panel */
A = [canvas];
const px = ML + leftW + 15;
gradRect(tmp('_pp'), pulseW, cardH, 21, 'rgba(31,50,57,0.6)', 'rgba(18,30,40,0.7)');
over(canvas, tmp('_pp'), px, gy, canvas);
A = [canvas];
stroke('rgba(113,244,184,0.12)', 2); op('-fill', 'none'); rrect(px, gy, pulseW, cardH, 21);
txt(px + 20, gy + 32, 9, F.monoM, '#6e9e99', 'SYSTEM PULSE', 1.2);
fill(C.mint); stroke('none'); circle(px + pulseW - 40, gy + 28, 4);
txt(px + pulseW - 32, gy + 32, 9, F.monoM, C.mint, 'LIVE', 0.8);
txt(px + 20, gy + 78, 16, F.interB, '#e4fff5', 'Контур активен');
txt(px + 20, gy + 100, 11, F.interR, '#78908e', '1 из 4 модулей запущено');
txt(px + pulseW - 60, gy + 78, 20, F.monoB, C.mint, '25%');
// chart
stroke('rgba(164,221,209,0.08)', 2); op('-fill', 'none');
line(px + 18, gy + 122, px + pulseW - 18, gy + 122);
line(px + 18, gy + 154, px + pulseW - 18, gy + 154);
line(px + 18, gy + 186, px + pulseW - 18, gy + 186);
stroke('#72e5bf', 4);
op('-draw', `stroke #72e5bf stroke-width 4 fill none translate ${S(px + 18)},${S(gy + 118)} scale ${S((pulseW - 36) / 330)},${S(96 / 110)} path 'M0 78 C20 76, 23 58, 42 66 S66 94, 87 63 S111 34, 133 55 S160 78, 180 48 S204 31, 225 53 S247 80, 270 39 S300 50, 330 23'`);
stroke(C.mint, 4); line(px + 20, gy + 200, px + 32, gy + 200);
txt(px + 38, gy + 204, 9, F.monoM, '#6f8b89', 'Запущено', 0.5);
txt(px + pulseW - 50, gy + 204, 9, F.monoB, C.mint, '1/4');
flush(canvas);

// downscale
run([canvas, '-resize', '1280x720', OUT]);
console.log('wrote', OUT, sizeOf(OUT).join('x'));
