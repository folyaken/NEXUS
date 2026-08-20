/* NEXUS update announcement card — 1280x720, brand-faithful.
   Edit VERSION / CHANGES below and re-run to get the next release's image. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const FD = path.join(__dirname, 'fonts');
const LOGO = path.join(REPO, 'brand', 'nexus-symbol-transparent.png');
const NO_BUTTON = process.argv.includes('--nobtn');
const OUT = path.join(REPO, 'promo', NO_BUTTON ? 'nexus-update-nobtn.png' : 'nexus-update.png');
const TMP = '/tmp/nexus_tmp';
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

/* ================= EDIT THESE PER RELEASE ================= */
const VERSION = '1.3.1';
const CHANGES = [
  { c: '#7cf2d5', t: 'Строка обновления в «О программе»' },
  { c: '#a895ff', t: 'Кнопка «Отключение всего» в иконке в трее' },
];
/* ============================================================ */

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
  bg: '#090d16', text: '#edf2fb', soft: '#d6deec', muted: '#8994a9', muted2: '#59657a',
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
  const mask = tmp('_um'), grad = tmp('_ug');
  run(['-background', 'none', '-fill', 'white', '-font', font, '-pointsize', String(S(size)),
    '-gravity', 'center', `label:${label}`, mask]);
  const [w, h] = sizeOf(mask);
  run(['-size', `${w}x${h}`, `gradient:${from}-${to}`, grad]);
  run([grad, mask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', out]);
  return [w, h];
}
function centerText(x, y, size, font, color, str) {
  const t = tmp('_ct');
  run(['-background', 'none', '-fill', color, '-font', font, '-pointsize', String(S(size)),
    '-gravity', 'center', `label:${str}`, t]);
  const [tw, th] = sizeOf(t);
  run([canvas, '(', t, ')', '-geometry', `+${S(x) - Math.round(tw / 2)}+${S(y) - Math.round(th / 2)}`, '-composite', canvas]);
}
function pill(out, label, font, size, fg, accent) {
  const text = tmp('_upt');
  run(['-background', 'none', '-fill', fg, '-font', font, '-pointsize', String(S(size)),
    '-gravity', 'center', `label:${label}`, text]);
  const [tw, th] = sizeOf(text);
  const pad = S(12), w = tw + pad * 2, h = th + S(12);
  run(['-size', `${w}x${h}`, 'xc:none', '-fill', 'none', '-stroke', accent, '-strokewidth', '2',
    '-draw', `roundrectangle 1,1 ${w - 2},${h - 2} ${h / 2},${h / 2}`, out]);
  run([out, text, '-gravity', 'center', '-compose', 'over', '-composite', out]);
}

/* ---------- build ---------- */
const canvas = tmp('ucard');
run(['-size', `${W}x${H}`, 'xc:' + C.bg, canvas]);

// ambient glows
const glow = tmp('_uglow');
run(['-size', `${W}x${H}`, 'xc:none', glow]);
run([glow, '-fill', 'rgba(168,149,255,0.16)',
  '-draw', `circle ${S(1080)},${S(300)} ${S(1080 + 330)},${S(300)}`, glow]);
run([glow, '-fill', 'rgba(124,242,213,0.14)',
  '-draw', `circle ${S(380)},${S(640)} ${S(380 + 330)},${S(640)}`, glow]);
run([glow, '-blur', '0x70', glow]);
over(canvas, glow, 0, 0, canvas);

// glass panel
const panel = tmp('_upanel');
run(['-size', `${S(1160)}x${S(640)}`, `gradient:rgba(31,42,62,0.55)-rgba(19,26,40,0.55)`, panel]);
const pmask = tmp('_upm');
run(['-size', `${S(1160)}x${S(640)}`, 'xc:black', '-fill', 'white',
  '-draw', `roundrectangle 0,0 ${S(1160) - 1},${S(640) - 1} ${S(28)},${S(28)}`, pmask]);
run([panel, pmask, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', panel]);
over(canvas, panel, 60, 40, canvas);

let A = [canvas];
const op = (A, ...a) => A.push(...a);
function fill(c) { op(A, '-fill', c); }
function stroke(c, w) { op(A, '-stroke', c); if (w != null) op(A, '-strokewidth', String(w)); }
function rrect(x, y, w, h, r) { op(A, '-draw', `roundrectangle ${S(x)},${S(y)} ${S(x + w)},${S(y + h)} ${S(r)},${S(r)}`); }
function line(x1, y1, x2, y2) { op(A, '-draw', `line ${S(x1)},${S(y1)} ${S(x2)},${S(y2)}`); }
function circle(cx, cy, rad) { op(A, '-draw', `circle ${S(cx)},${S(cy)} ${S(cx + rad)},${S(cy)}`); }
function txt(x, y, size, font, color, str, kerning = 0) {
  fill(color);
  if (kerning) op(A, '-kerning', String(kerning * 2));
  op(A, '-font', font, '-pointsize', String(S(size)));
  op(A, '-draw', `text ${S(x)},${S(y)} '${str.replace(/'/g, '')}'`);
  if (kerning) op(A, '-kerning', '0');
}

stroke('rgba(255,255,255,0.07)', 2); fill('none'); rrect(60, 40, 1160, 640, 28);

/* ---- top row: brand (left) + UPDATE badge (right) ---- */
const LX = 132;
run([LOGO, '-resize', `${S(96)}x${S(96)}`, tmp('_ulogo')]);
over(canvas, tmp('_ulogo'), LX, 112, canvas);
A = [canvas];
gradText(tmp('_uwm'), 'NEXUS', F.sgB, 58, '#7cf2d5', '#a895ff');
over(canvas, tmp('_uwm'), LX + 116, 138, canvas);
A = [canvas];
pill(tmp('_ubadge'), 'ОБНОВЛЕНИЕ', F.monoB, 17, C.amber, 'rgba(248,199,108,0.42)');
const [bw] = sizeOf(tmp('_ubadge'));
over(canvas, tmp('_ubadge'), 1148 - bw / 2, 126, canvas);

// top divider
A = [canvas];
run(['-size', `${S(1016)}x${S(2)}`, 'gradient:rgba(124,242,213,0.5)-rgba(124,242,213,0)', tmp('_urule')]);
over(canvas, tmp('_urule'), LX, 258, canvas);

/* ---- left column: "что нового" ---- */
A = [canvas];
txt(LX, 318, 15, F.monoM, C.muted2, 'ЧТО НОВОГО', 1.8);
txt(LX, 356, 26, F.interB, C.text, 'В версии 1.3.1');
CHANGES.forEach((f, i) => {
  const y = 410 + i * 56;
  fill(f.c); stroke('none'); circle(LX + 6, y - 5, 5);
  txt(LX + 26, y, 21, F.interR, C.text, f.t);
});
txt(LX, 560, 13, F.interR, C.muted, 'Обновление в один клик — вкладка «О программе»');
run(A, canvas);

/* ---- right: orbit + big version ---- */
const OCX = 880, OCY = 392;
run([LOGO, '-resize', `${S(320)}x${S(320)}`, '-channel', 'A', '-evaluate', 'multiply', '0.10', '+channel', tmp('_uwmb')]);
over(canvas, tmp('_uwmb'), OCX - 160, OCY - 160, canvas);
A = [canvas];
stroke('rgba(122,241,216,0.20)', 2); fill('none');
op(A, '-draw', `ellipse ${S(OCX)},${S(OCY)} ${S(168)},${S(168)} 0,360`);
stroke('rgba(168,149,255,0.22)', 2);
op(A, '-draw', `ellipse ${S(OCX)},${S(OCY)} ${S(216)},${S(96)} 0,360`);
fill('#dffbf5'); stroke('none'); circle(OCX - 130, OCY - 96, 3);
fill(C.violet); circle(OCX + 160, OCY + 44, 2);
run(A, canvas);

// big version (centered in orbit)
const [vw, vh] = gradText(tmp('_uver'), VERSION, F.sgB, 120, '#7cf2d5', '#a895ff');
over(canvas, tmp('_uver'), OCX - vw / 4, OCY - vh / 4, canvas);

// caption under version (centered)
centerText(OCX, 560, 15, F.monoM, C.muted, 'Обновление доступно');

/* ---- CTA pill (right bottom) — only when a real button can't be attached ---- */
if (!NO_BUTTON) {
  A = [canvas];
  const cta = tmp('_ucta');
  run(['-size', `${S(360)}x${S(64)}`, 'xc:none', '-fill', '#83efd1', '-stroke', 'none',
    '-draw', `roundrectangle 0,0 ${S(360) - 1},${S(64) - 1} ${S(32)},${S(32)}`, cta]);
  run(['-background', 'none', '-fill', '#121827', '-font', F.interEB,
    '-pointsize', String(S(24)), '-gravity', 'center', 'label:Скачать обновление', tmp('_uctat')]);
  run([cta, tmp('_uctat'), '-gravity', 'center', '-compose', 'over', '-composite', cta]);
  over(canvas, cta, OCX - 180, 596, canvas);
}

/* ---- footer ---- */
A = [canvas];
stroke('rgba(255,255,255,0.06)', 2); line(132, 680, 1148, 680);
stroke('none');
txt(132, 710, 15, F.interM, C.muted, 'NEXUS — Network Control Plane');
run(A, canvas);
const gh = tmp('_ugh');
run(['-background', 'none', '-font', F.monoM, '-pointsize', String(S(15)), '-fill', C.cyan,
  '-gravity', 'center', 'label:github.com/folyaken/NEXUS-releases', gh]);
const [ghw, ghh] = sizeOf(gh);
run([canvas, '(', gh, ')', '-geometry', `+${2296 - ghw}+${Math.round(2 * 703 - ghh / 2)}`, '-composite', canvas]);

// downscale
run([canvas, '-resize', '1280x720', OUT]);
console.log('wrote', OUT, sizeOf(OUT).join('x'));
