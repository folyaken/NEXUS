'use strict';

/*
 * Построение оформления «Графит» из основного стиля.
 *
 * Тема правилась вручную, и это не сработало: в интерфейсе больше восьмисот
 * правил с прямо прописанными цветами, руками их обошли меньше чем наполовину.
 * Тумблеры оставались зелёными, лента логотипа — изумрудной, полоса прокрутки
 * бирюзовой: всё это цвета «Индиго», которые к графиту отношения не имеют.
 *
 * Поэтому тема считается из самого стиля, как «Багровое»: разбираем правила,
 * находим каждый цвет и пересчитываем его в графитово-лавандовую гамму. Пока
 * цвет записан в styles.css, он попадёт в тему сам — новый экран не забудут.
 */

const BEGIN = '/* === НАЧАЛО: оформление «Графит» (создаётся scripts/make-graphite-theme.cjs) === */';
const END = '/* === КОНЕЦ: оформление «Графит» === */';

/*
 * Места, которые перекрашивать нельзя.
 *
 * Флаги стран узнают именно по цвету, кружки переключателя тем показывают
 * палитру каждой темы, а логотипы Telegram и Discord — чужие товарные знаки.
 */
const KEEP_ORIGINAL = [
  'server-flag',
  'theme-dot',
  'appearance-options i',
  'tg-brand',
  'discord',
  'brand-logo',
];

/** Разбор CSS на правила верхнего уровня. Вложенные @-правила разворачиваются. */
function parseRules(css) {
  const out = [];
  // Комментарии убираются заранее: иначе пояснение прилипает к селектору.
  const text0 = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (text, at) => {
    let i = 0;
    let head = '';
    while (i < text.length) {
      const ch = text[i];
      if (ch === '{') {
        const selector = head.trim();
        head = '';
        let depth = 1;
        let j = i + 1;
        while (j < text.length && depth > 0) {
          if (text[j] === '{') depth += 1;
          else if (text[j] === '}') depth -= 1;
          j += 1;
        }
        const body = text.slice(i + 1, j - 1);
        if (selector.startsWith('@')) walk(body, at ? `${at}|${selector}` : selector);
        else out.push({ selector, body, at });
        i = j;
        continue;
      }
      if (ch === '}') { head = ''; i += 1; continue; }
      head += ch;
      i += 1;
    }
  };
  walk(text0, '');
  return out;
}

const COLOR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*(?:,\s*[\d.]+\s*)?\)/g;

function readColor(token) {
  if (token[0] === '#') {
    let hex = token.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      hex: true,
    };
  }
  const parts = token.match(/[\d.]+/g).map(Number);
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1, hex: false };
}

function toHsl({ r, g, b }) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const c = max - min;
  let h = 0;
  if (c > 0) {
    if (max === rr) h = ((gg - bb) / c + (gg < bb ? 6 : 0)) * 60;
    else if (max === gg) h = ((bb - rr) / c + 2) * 60;
    else h = ((rr - gg) / c + 4) * 60;
  }
  return { h, c, l };
}

function fromHsl(h, c, l) {
  const chroma = Math.max(0, Math.min(c, 1 - Math.abs(2 * l - 1)));
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));
  let rgb = [0, 0, 0];
  if (hp < 1) rgb = [chroma, x, 0];
  else if (hp < 2) rgb = [x, chroma, 0];
  else if (hp < 3) rgb = [0, chroma, x];
  else if (hp < 4) rgb = [0, x, chroma];
  else if (hp < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const m = l - chroma / 2;
  return rgb.map((v) => Math.max(0, Math.min(255, Math.round((v + m) * 255))));
}

/*
 * Пересчёт одного цвета в графитово-лавандовую гамму.
 *
 * Пара лаванды задана заказчиком: светлая #c6b6fb (оттенок 254) и тёмная
 * #7a63e0 (оттенок 251). Роли у них разные и это принципиально: светлая
 * читается на графите с запасом (контраст 10.7) и идёт в текст, значки и
 * тонкие линии; тёмная (контраст 4.4) — в заливки кнопок и активных состояний,
 * где поверх лежит тёмная надпись.
 *
 * Устройство темы повторяет «Индиго»: подложки почти нейтральные, цвет живёт
 * только в акцентах. Если поднять насыщенность всему подряд, интерфейс
 * начинает светиться — эту ошибку уже проходили на «Багровом».
 */
const LAV_LIGHT_HUE = 254;
const LAV_DEEP_HUE = 251;

function repaint(token) {
  const colour = readColor(token);
  const { h, c, l } = toHsl(colour);

  // Чистые чёрный и белый не трогаем: это тени и блики, они дают объём и
  // одинаково уместны в любой теме.
  if (c < 0.008) return token;

  let hue;
  let lightness = l;
  let chroma;

  if (c < 0.2) {
    /*
      Подложки, рамки и обычный текст.

      Насыщенность срезается почти полностью — это графит, а не лаванда. Лёгкий
      холодный налёт нужен лишь чтобы серый не выглядел грязным рядом с
      лавандовыми акцентами.
    */
    hue = LAV_LIGHT_HUE;
    chroma = Math.min(c * 0.34, 0.05);
    // Фон и панели уводим глубже: графит должен оставаться тёмным.
    if (l < 0.25) lightness = l * 0.74;
    // Приглушённый текст слегка поднимаем, иначе подписи теряются на графите.
    else if (l < 0.66) lightness = Math.min(0.72, l * 1.1);
  } else {
    /*
      Акценты. Всё цветное сводится к лаванде, но оттенок выбирается по
      светлоте исходного цвета, а не по его тону: светлые акценты (текст,
      значки) получают светлую лаванду, плотные заливки — глубокую. Так
      сохраняется контраст, ради которого пара и задавалась.
    */
    /*
      Состояния сохраняют смысл.

      Если свести к лаванде вообще всё, «работает», «внимание» и «ошибка»
      становятся одним и тем же сиреневым пятном, и по цвету уже не понять, что
      случилось — подсветка теряет смысл. Поэтому предупреждение и ошибка
      остаются собой, только приглушёнными, чтобы не спорить с лавандой.
      Зелёный и бирюзовый уходят в лаванду: это «всё хорошо», основной акцент.
    */
    const warm = h >= 20 && h < 60;      // жёлтый: предупреждение
    const danger = h >= 330 || h < 20;   // красный: ошибка
    if (warm || danger) {
      hue = warm ? 38 : 352;
      chroma = Math.min(0.42, c * 0.72);
      lightness = Math.max(0.42, Math.min(l, 0.74));
      const [wr, wg, wb] = fromHsl(hue, chroma, lightness);
      if (colour.a >= 1 && colour.hex) {
        return `#${[wr, wg, wb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      }
      if (colour.a >= 1) return `rgb(${wr},${wg},${wb})`;
      return `rgba(${wr},${wg},${wb},${String(colour.a).replace(/^0\./, '.')})`;
    }

    const deep = l < 0.6;
    hue = deep ? LAV_DEEP_HUE : LAV_LIGHT_HUE;

    /*
      Насыщенность подобрана по самой паре, а не «на глаз».

      У светлой лаванды #c6b6fb хрома 0.27, у глубокой #7a63e0 — 0.49. Первый
      вариант генератора поднимал её почти до 0.8, и вместо мягкой лаванды
      выходил ядовитый электрик: цвет верный по оттенку, но кричит.
      Держимся в границах заданной пары.
    */
    chroma = Math.min(deep ? 0.50 : 0.29, c * 0.62 + 0.06);

    // Светлая лаванда — потолок для ярких акцентов, выше начинает слепить.
    if (l > 0.85) lightness = 0.85;
    // Глубокую держим в её собственном диапазоне: это заливки кнопок.
    if (deep && l > 0.42) lightness = Math.min(l, 0.66);
    // Тёмные заливки не даём всплывать, иначе панели теряют глубину.
    if (l < 0.26) { lightness = l * 0.7; chroma = Math.min(chroma, 0.3); }
  }

  const [r, g, b] = fromHsl(hue, chroma, Math.max(0, Math.min(1, lightness)));
  if (colour.a >= 1 && colour.hex) {
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  if (colour.a >= 1) return `rgb(${r},${g},${b})`;
  const alpha = String(colour.a).replace(/^0\./, '.');
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Разбор тела правила на объявления по верхнеуровневым точкам с запятой. */
function splitDeclarations(body) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ';' && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  out.push(current);
  return out.map((d) => d.trim()).filter(Boolean);
}

function hasRepaintableColour(text) {
  const tokens = text.match(COLOR) || [];
  return tokens.some((token) => repaint(token) !== token);
}

/** Приставка темы к готовому селектору. */
function prefixSelector(selector) {
  return selector
    .split(',')
    .map((part) => {
      const value = part.trim().replace(/\s+/g, ' ');
      if (!value) return '';
      if (value === ':root') return '.appearance-graphite';
      if (value.startsWith('.app-frame')) return value.replace('.app-frame', '.app-frame.appearance-graphite');
      if (value.startsWith('.appearance-graphite')) return value;
      return `.appearance-graphite ${value}`;
    })
    .filter(Boolean)
    .join(',\n');
}

function isSkipped(selector) {
  if (/\.appearance-(graphite|crimson)\b/.test(selector)) return true;
  // Фоновый узор темы описан вручную — он и так лавандовый.
  if (selector.includes('node-web')) return true;
  return KEEP_ORIGINAL.some((mark) => selector.includes(mark));
}

function stripGenerated(css) {
  const from = css.indexOf(BEGIN);
  if (from === -1) return css;
  const to = css.indexOf(END, from);
  return to === -1 ? css.slice(0, from) : css.slice(0, from) + css.slice(to + END.length);
}

function buildTheme(css) {
  const base = stripGenerated(css);
  const rules = parseRules(base);
  const lines = [];

  for (const rule of rules) {
    if (rule.at) continue;
    if (isSkipped(rule.selector)) continue;
    const all = splitDeclarations(rule.body);
    const kept = all.filter((decl) => hasRepaintableColour(decl));
    if (!kept.length) continue;
    const painted = kept.map((decl) => decl.replace(COLOR, (token) => repaint(token)));

    /*
      Спутники сокращённой записи background.

      Сокращённая запись сбрасывает свойства своего семейства, которые в ней не
      указаны. Если рядом стояло background-clip: text, а тема переопределила
      только background, обрезка по буквам пропадёт и градиентный заголовок
      превратится в закрашенную плашку — так уже ломался «Обзор» в «Багровом».
    */
    if (painted.some((decl) => /^background\s*:/.test(decl))) {
      for (const decl of all) {
        if (/^(-webkit-)?background-(clip|size|position|repeat|origin|attachment)\s*:/.test(decl)
          || /^(-webkit-)?text-fill-color\s*:/.test(decl)) {
          if (!painted.includes(decl)) painted.push(decl);
        }
      }
    }

    const selector = prefixSelector(rule.selector);
    if (!selector) continue;
    lines.push(`${selector} { ${painted.join('; ')}; }`);
  }

  return lines;
}

/** Готовый текст блока темы. */
function buildBlock(css) {
  const rules = buildTheme(css);
  return [
    BEGIN,
    '/*',
    ' * Блок создан автоматически из основного стиля: каждое правило с цветом',
    ' * пересчитано в графитово-лавандовую гамму. Руками его не правят — при',
    ' * следующей сборке правки затрутся. Меняют либо основной стиль, либо',
    ' * пересчёт цвета в scripts/graphite-theme.cjs, затем выполняют',
    ' * npm run theme:graphite.',
    ' */',
    ...rules,
    '',
    '/* Мерцание короны лучшего сервера: ключевые кадры нельзя приписать теме',
    '   селектором, поэтому для неё заведён отдельный набор кадров. */',
    '@keyframes crown-glow-graphite {',
    '  0%, 100% { box-shadow: 0 3px 10px rgba(0,0,0,.5), 0 0 12px rgba(198,182,251,.28); }',
    '  50% { box-shadow: 0 3px 10px rgba(0,0,0,.5), 0 0 20px rgba(198,182,251,.5); }',
    '}',
    '.appearance-graphite .server-row.is-best .server-crown { animation-name: crown-glow-graphite; }',
    '',
    '/* Карточка «Последний скан» — сведения, а не предупреждение: жёлтый здесь',
    '   ничего не сообщает и спорит с лавандовым акцентом. Пересчёт сохраняет',
    '   жёлтый для настоящих предупреждений, поэтому карточка перекрашивается',
    '   отдельным правилом. */',
    '.appearance-graphite .stat-card.tone-amber .stat-icon { border-color: rgba(178,161,234,.24); background: linear-gradient(150deg, rgba(178,161,234,.2), rgba(178,161,234,.05)); color: #c6b6fb; box-shadow: inset 0 1px rgba(255,255,255,.1), 0 6px 16px rgba(122,99,224,.16); }',
    '',
    '/* Флаги стран, кружки выбора темы и чужие логотипы остаются цветными:',
    '   страну и марку узнают именно по цвету. */',
    '.appearance-graphite .server-flag-svg,',
    '.appearance-graphite .server-flag-svg * { filter: none; }',
    END,
  ].join('\n');
}

module.exports = { BEGIN, END, parseRules, repaint, buildTheme, buildBlock, stripGenerated, prefixSelector };
