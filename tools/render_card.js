/* NEXUS welcome card (first post / channel face) — 1280x720, brand-faithful.
   Richer layout: app window bar + brand + features + mini-dashboard panel. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const FD = path.join(__dirname, 'fonts');
const LOGO = path.join(REPO, 'brand', 'nexus-symbol-transparent.png');
const OUT = path.join(REPO, 'promo', 'nexus-card.png');
const TMP = '/tmp/nexus_card';
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
  monoR: path.join(FD, 'JBMono-Regular.ttf'),
  monoM: path.join(FD, 'JBMono-Medium.ttf'),
  monoB: path.join(FD, 'JBMono-Bold.ttf'),
};

const C = {
  bg: '#090d16', bar: '#17191f', text: '#edf2fb', soft: '#d6deec',
  muted: '#8994a9', muted2: '#59657a', kicker: '#71809a',
  cyan: '#7cf2d5', violet: '#a895ff', mint: '#71f4b8', amber: '#f8c76c',
};

const S = (v) => Math.round(v * 2);
const W = 2560, H = 1440;

function run(args, out) { execFileSync('convert', out ? args.concat(out) : args, { stdio: 'inherit' }); }
function sizeOf(f) { return execFileSync('identify', ['-format', '%w %h', f], { encoding: 'utf8' }).trim().split(/\s+/).map(Number); }
const tmp = (n) => path.join(TMP, n + '.png');
function over(base, layer, x, y, out) {
  run([base, '(', layer, ')', '-geometry', `+${S(x)}+${S(y)}`, '-composite', out || base]);
}
function gradText(out, label, font, size, from, to) {
  const mask = tmp('_gm'), grad = tmp('_gg');
  run(['-background', 'none', '-fill', 'white', '-font', font, '-pointsize', String(S(size)),
    '-gravity', 'center', `label:${label}`, mask]);
  const [w, h] = sizeOf(mask);
  run(['-size', `${w}x${h}`, `gradient:${from}-${to}`, grad]);
  run([grad, mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', out]);
  return [w, h];
}
function pill(out, label, font, size, fg, accent) {
  const text = tmp('_pt');
  run(['-background', 'none', '-fill', fg, '-font', font, '-pointsize', String(S(size)),
    '-gravity', 'center', `label:${label}`, text]);
  const [tw, th] = sizeOf(text);
  const pad = S(10), w = tw + pad * 2, h = th + S(10);
  run(['-size', `${w}x${h}`, 'xc:none', '-fill', 'none', '-stroke', accent, '-strokewidth', '2',
    '-draw', `roundrectangle 1,1 ${w - 2},${h - 2} ${h / 2},${h / 2}`, out]);
  run([out, text, '-gravity', 'center', '-compose', 'over', '-composite', out]);
}

/* draw-op state machine */
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
  const [font, color] = String(a).includes('.ttf') || String(a).includes('/fonts/') ? [a, b] : [b, a];
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

const SVG = {
  nexus: `path 'M4.2 13.6v-4l3-3 4.8 5.2 4.8-5.2 3 3v4l-3 3-4.8-5.2-4.8 5.2-3-3Z'`,
  shield: `path 'M12 2l8 3v5c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z'`,
  diamond: `path 'M12 4l6.5 8L12 20l-6.5-8z'`,
  star4: `path 'M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z'`,
  refresh: `path 'M19 8a7.5 7.5 0 1 0 .9 7'`,
  lock: `path 'M7 10V8a5 5 0 0 1 10 0v2M6 10h12v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z'`,
};

/* ================= BUILD ================= */
const canvas = tmp('card');
run(['-size', `${W}x${H}`, 'xc:' + C.bg, canvas]);

// ambient glows
const glow = tmp('_glow');
run(['-size', `${W}x${H}`, 'xc:none', glow]);
run([glow, '-fill', 'rgba(124,242,213,0.14)',
  '-draw', `circle ${S(380)},${S(180)} ${S(380 + 320)},${S(180)}`, glow]);
run([glow, '-fill', 'rgba(168,149,255,0.15)',
  '-draw', `circle ${S(980)},${S(560)} ${S(980 + 340)},${S(560)}`, glow]);
run([glow, '-blur', '0x70', glow]);
over(canvas, glow, 0, 0, canvas);

/* ---- window bar ---- */
A = [canvas];
fill(C.bar); stroke('none'); rect(0, 0, 1280, 36);
stroke('rgba(255,255,255,0.07)', 2); line(0, 36, 1280, 36);
// brand mark
fill('rgba(124,242,213,0.1)'); stroke('rgba(124,242,213,0.3)', 2); rrect(12, 9, 18, 18, 6);
glyph(21, 18, 13, C.cyan, 1.5, SVG.nexus);
txt(40, 23, 10, F.sgB, '#cbd3df', 'NEXUS', 1.2);
txt(88, 23, 10, F.interR, '#8d96a8', '/');
txt(98, 23, 10, F.interR, '#8d96a8', 'Network Control Plane');
// version pill
pill(tmp('_verpill'), 'v1.1.9', F.monoB, 11, C.cyan, 'rgba(124,242,213,0.28)');
const [vpw] = sizeOf(tmp('_verpill'));
over(canvas, tmp('_verpill'), 1168 - vpw / 2, 12, canvas);
// window controls
A = [canvas];
stroke('#919baa', 2.5);
line(1190, 18, 1202, 18);
stroke('#919baa', 2); op('-fill', 'none'); rrect(1209, 11, 12, 12, 2);
line(1231, 11, 1243, 27); line(1243, 11, 1231, 27);
flush(canvas);

/* ---- left column ---- */
const LX = 40;
// logo
run([LOGO, '-resize', `${S(96)}x${S(96)}`, tmp('_logo')]);
over(canvas, tmp('_logo'), LX, 62, canvas);
// wordmark
A = [canvas];
gradText(tmp('_wm'), 'NEXUS', F.sgB, 56, '#7cf2d5', '#a895ff');
over(canvas, tmp('_wm'), LX + 118, 84, canvas);
// subtitle
A = [canvas];
txt(LX + 122, 128, 13, F.monoM, C.muted2, 'NETWORK CONTROL PLANE', 1.5);
// tagline
txt(LX, 176, 18, F.interM, '#c6d0de', 'Единый центр управления сетью.');
txt(LX, 202, 14, F.interR, C.muted, 'VPN · обход блокировок · прокси для Telegram.');
flush(canvas);

// divider
A = [canvas];
run(['-size', `${S(500)}x${S(2)}`, 'gradient:rgba(124,242,213,0.5)-rgba(124,242,213,0)', tmp('_rule')]);
over(canvas, tmp('_rule'), LX, 228, canvas);

// features
A = [canvas];
txt(LX, 262, 11, F.monoM, C.kicker, 'ЧТО ВНУТРИ', 1.8);
const feats = [
  { c: C.cyan, t: 'Jey2Ray — VPN на Xray-core' },
  { c: C.violet, t: 'Обход DPI — YouTube и Discord' },
  { c: C.mint, t: 'TG WS Proxy — Telegram без блокировок' },
  { c: C.amber, t: 'Журнал · автозапуск · трей' },
];
feats.forEach((f, i) => {
  const y = 294 + i * 38;
  fill(f.c); stroke('none'); circle(LX + 5, y - 5, 4.5);
  txt(LX + 22, y, 16, F.interR, C.text, f.t);
});
flush(canvas);

// privacy note (bottom-left)
A = [canvas];
fill('rgba(113,244,184,0.05)'); stroke('rgba(113,244,184,0.14)', 2);
rrect(LX, 498, 380, 52, 13);
glyph(LX + 22, 524, 20, C.mint, 1.6, SVG.lock);
txt(LX + 44, 518, 13, '#d8f8e9', F.interSB, 'Локально и безопасно');
txt(LX + 44, 538, 11, '#708b86', F.interR, 'Данные не покидают ваше устройство');
flush(canvas);

// badges
A = [canvas];
pill(tmp('_b1'), 'Windows', F.monoM, 12, '#c3cbd8', 'rgba(255,255,255,0.16)');
pill(tmp('_b2'), 'Linux', F.monoM, 12, '#c3cbd8', 'rgba(255,255,255,0.16)');
pill(tmp('_b3'), 'Electron · React · TS', F.monoM, 12, '#c4baff', 'rgba(168,149,255,0.28)');
let bx = LX;
over(canvas, tmp('_b1'), bx, 588, canvas);
bx = LX + sizeOf(tmp('_b1'))[0] / 2 + 10;
over(canvas, tmp('_b2'), bx, 588, canvas);
bx = bx + sizeOf(tmp('_b2'))[0] / 2 + 10;
over(canvas, tmp('_b3'), bx, 588, canvas);

/* ---- right panel: mini dashboard ---- */
const PX = 648, PY = 56, PW = 608, PH = 620;
const pg = tmp('_panel');
run(['-size', `${S(PW)}x${S(PH)}`, `gradient:rgba(31,42,62,0.6)-rgba(19,26,40,0.6)`, pg]);
const pmask = tmp('_pm');
run(['-size', `${S(PW)}x${S(PH)}`, 'xc:black', '-fill', 'white',
  '-draw', `roundrectangle 0,0 ${S(PW) - 1},${S(PH) - 1} ${S(24)},${S(24)}`, pmask]);
run([pg, pmask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', pg]);
over(canvas, pg, PX, PY, canvas);

// orbit watermark behind panel content
run([LOGO, '-resize', `${S(250)}x${S(250)}`, '-channel', 'A', '-evaluate', 'multiply', '0.07', '+channel', tmp('_wmbig')]);
over(canvas, tmp('_wmbig'), PX + PW - 250 - 20, PY + 40, canvas);
A = [canvas];
stroke('rgba(122,241,216,0.14)', 2); op('-fill', 'none');
ellipse(PX + PW - 150, PY + 170, 130, 130);
stroke('rgba(168,149,255,0.16)', 2);
ellipse(PX + PW - 150, PY + 170, 170, 78);
flush(canvas);

// panel header
A = [canvas];
txt(PX + 20, PY + 34, 10, F.monoM, C.muted2, 'NEXUS · DASHBOARD', 1.2);
fill(C.mint); stroke('none'); circle(PX + PW - 60, PY + 30, 4);
txt(PX + PW - 50, PY + 34, 9, C.mint, F.monoB, 'LIVE', 1);
flush(canvas);

// stat strip (3 mini cards)
const sx = PX + 20, sy = PY + 52, scw = 182, sch = 62, sgap = 10;
const stats = [
  { l: 'МОДУЛИ', v: '04', c: C.cyan },
  { l: 'VPN · ЯДРО', v: 'Xray-core', c: C.violet, small: true },
  { l: 'ДАННЫЕ', v: 'Локально', c: C.mint, small: true },
];
A = [canvas];
stats.forEach((s, i) => {
  const x = sx + i * (scw + sgap);
  fill('rgba(255,255,255,0.03)'); stroke('rgba(255,255,255,0.06)', 2);
  rrect(x, sy, scw, sch, 12);
  txt(x + 14, sy + 26, 8, F.monoM, C.kicker, s.l, 1);
  txt(x + 14, sy + 50, s.small ? 16 : 22, F.interB, '#ecf3ff', s.v);
});
flush(canvas);

// module grid 2x2
const mx = PX + 20, my = PY + 132, mw = 277, mh = 168, mgap = 12;
const mods = [
  { n: 'Jey2Ray VPN', s: 'Активен', on: true, c: C.cyan, g: 'diamond' },
  { n: 'Обход DPI', s: 'Готов', on: false, c: C.violet, g: 'shield' },
  { n: 'TG WS Proxy', s: 'Готов', on: false, c: C.mint, g: 'star4' },
  { n: 'DNS Guard', s: 'В разработке', on: false, c: C.amber, g: 'refresh' },
];
const glyphMap = { diamond: SVG.diamond, shield: SVG.shield, star4: SVG.star4, refresh: SVG.refresh };
A = [canvas];
mods.forEach((m, i) => {
  const x = mx + (i % 2) * (mw + mgap), y = my + Math.floor(i / 2) * (mh + mgap);
  fill('rgba(21,29,44,0.55)'); stroke('rgba(255,255,255,0.06)', 2);
  rrect(x, y, mw, mh, 14);
  // icon
  fill('rgba(124,242,213,0.1)'); stroke('rgba(255,255,255,0.08)', 2);
  rrect(x + 13, y + 13, 34, 34, 10);
  stroke(m.c, 2.5); op('-fill', 'none');
  glyph(x + 30, y + 30, 20, m.c, 1.6, glyphMap[m.g]);
  // name
  txt(x + 58, y + 28, 14, F.interB, '#eaf1fc', m.n);
  // status
  const sc = m.on ? C.mint : (m.s === 'В разработке' ? C.amber : '#78849d');
  fill(sc); stroke('none'); circle(x + 60, y + 44, 3.5);
  txt(x + 68, y + 48, 10, sc === C.mint ? '#82e9bd' : sc === C.amber ? C.amber : '#9aa7ba', F.interR, m.s);
  // toggle
  const tx = x + mw - 50, ty = y + 20;
  fill(m.on ? 'rgba(92,231,176,0.9)' : '#252d3c'); stroke('none');
  rrect(tx, ty, 38, 20, 10);
  const kx = m.on ? tx + 20 : tx + 8;
  fill(m.on ? '#f3fffa' : '#d6dbe6');
  circle(kx, ty + 10, 8);
});
flush(canvas);

// panel bottom note
A = [canvas];
fill('rgba(168,149,255,0.06)'); stroke('rgba(168,149,255,0.16)', 2);
rrect(PX + 20, PY + PH - 66, PW - 40, 44, 12);
glyph(PX + 40, PY + PH - 44, 18, C.violet, 1.6, SVG.nexus);
txt(PX + 56, PY + PH - 48, 12, '#d3caff', F.interSB, 'Всё в одном окне');
txt(PX + 56, PY + PH - 28, 10, '#8b83ad', F.interR, 'Модули · VPN · журнал · настройки');
flush(canvas);

/* ---- footer ---- */
A = [canvas];
stroke('rgba(255,255,255,0.06)', 2); line(40, 682, 1240, 682);
stroke('none');
txt(40, 710, 13, F.interM, C.muted, 'NEXUS — Network Control Plane');
flush(canvas);
const gh = tmp('_gh');
run(['-background', 'none', '-font', F.monoM, '-pointsize', String(S(13)), '-fill', C.cyan,
  '-gravity', 'center', 'label:github.com/folyaken/NEXUS', gh]);
const [ghw, ghh] = sizeOf(gh);
run([canvas, '(', gh, ')', '-geometry', `+${S(1240) - ghw}+${Math.round(S(703) - ghh / 2)}`, '-composite', canvas]);

// downscale
run([canvas, '-resize', '1280x720', OUT]);
console.log('wrote', OUT, sizeOf(OUT).join('x'));
