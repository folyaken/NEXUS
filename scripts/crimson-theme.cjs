'use strict';

/*
 * Построение оформления «Багровое» из основного стиля.
 *
 * Первая версия темы задавалась одними переменными цвета, и этого не хватило:
 * в интерфейсе сотни правил с прямо прописанными цветами (бирюзовые рамки,
 * фиолетовые карточки, зелёные значки состояния), переменных они не знают, и
 * на чёрно-красном фоне оставались синими и зелёными пятнами.
 *
 * Перекрашивать их вручную — та же ошибка, что была с «Графитом»: любой новый
 * экран забудут добавить. Поэтому тема считается из самого стиля: разбираем
 * основные правила, находим каждый цвет, пересчитываем его в чёрно-красную
 * гамму и выводим готовый блок правил. Пока цвет записан в styles.css, он
 * попадёт в тему сам.
 */

// Начало и конец созданного блока. По ним же его находят при пересборке,
// чтобы тема не удваивалась.
const BEGIN = '/* === НАЧАЛО: оформление «Багровое» (создаётся scripts/make-crimson-theme.cjs) === */';
const END = '/* === КОНЕЦ: оформление «Багровое» === */';

/*
 * Места, которые перекрашивать нельзя.
 *
 * Флаги стран узнают именно по цвету, кружки переключателя тем показывают
 * палитру каждой темы (багровый кружок обязан отличаться от бирюзового), а
 * логотипы Telegram и Discord — чужие товарные знаки, их цвет менять нельзя.
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
  // Комментарии убираются заранее: иначе пояснение перед правилом прилипает к
  // селектору и в тему попадает мусор вида «/* Цвет переключателя ... .toggle».
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
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
  walk(css, '');
  return out;
}

const COLOR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*(?:,\s*[\d.]+\s*)?\)/g;

function readColor(token) {
  if (token[0] === '#') {
    let hex = token.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((c) => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a, hex: true };
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
 * Пересчёт одного цвета в чёрно-красную гамму.
 *
 * Оттенок задаётся не одним красным на всё: если свести к нему и состояния,
 * пропадёт смысл цвета — «работает», «внимание» и «ошибка» станут одинаковыми.
 * Поэтому исходный оттенок раскладывается на четыре тона одной семьи:
 *   зелёный и бирюзовый  -> алый (основной акцент, «всё хорошо»);
 *   синий и фиолетовый   -> тёмно-вишнёвый (второй тон оформления);
 *   жёлтый и оранжевый   -> тон углей (предупреждение);
 *   красный и розовый    -> густой кровавый (ошибка).
 * Так тема остаётся чёрно-красной, а состояния по-прежнему различимы.
 */
function repaint(token) {
  const colour = readColor(token);
  const { h, c, l } = toHsl(colour);

  // Чистые чёрный и белый не трогаем: это тени и блики, они дают объём и
  // одинаково уместны в любой теме. Перекрашивание превратило бы их в розовую
  // дымку по всему интерфейсу.
  if (c < 0.008) return token;

  let hue;
  let lightness = l;
  let chroma;

  /*
    Тема повторяет устройство «Индиго», а не заливает всё красным.

    В «Индиго» насыщенность распределена неравномерно, и именно это делает его
    спокойным: фон и панели почти нейтральные (насыщенность 0.05–0.18), цвет
    живёт только в акцентах (0.42–0.56). Первая версия «Багрового» поднимала
    насыщенность всему подряд, поэтому интерфейс светился и резал глаза.

    Теперь роль каждого цвета сохраняется: подложки уходят в чёрный с едва
    заметным тёплым налётом, а сочный красный остаётся только там, где в
    «Индиго» стоял бирюзовый или фиолетовый.
  */
  if (c < 0.2) {
    // Подложки, рамки и текст. Насыщенность срезается почти полностью: это
    // чернота, а не красный. Слабый тёплый налёт нужен лишь для того, чтобы
    // серый не отдавал синевой рядом с красными акцентами.
    hue = 352;
    chroma = Math.min(c * 0.38, 0.055);
    // Фон и панели уводим глубже в черноту — её в теме должно быть больше.
    if (l < 0.25) lightness = l * 0.72;
    // Приглушённый текст, наоборот, слегка поднимаем: тёплый оттенок на чёрном
    // читается хуже холодного, и без этого подписи и время в журнале терялись.
    else if (l < 0.66) lightness = Math.min(0.72, l * 1.12);
  } else {
    // Акценты. Оттенок раскладывается на четыре тона одной семьи, иначе
    // «работает», «внимание» и «ошибка» сольются в одно пятно.
    if (h >= 60 && h < 200) hue = 354;          // зелёный и бирюзовый -> алый
    else if (h >= 200 && h < 280) hue = 342;    // синий и фиолетовый -> вишнёвый
    else if (h >= 280 && h < 330) hue = 348;    // сиреневый -> малиновый
    else if (h >= 20 && h < 60) hue = 18;       // жёлтый -> тон углей
    else hue = 358;                             // красный остаётся красным
    // Насыщенность держим высокой, а светлоту опускаем: сочный цвет получается
    // из густоты, а не из яркости. Светлый насыщенный красный на чёрном
    // «звенит» — именно от него уставали глаза, — а густой читается спокойно.
    chroma = Math.min(0.78, c * 1.15);
    if (l > 0.52) lightness = 0.52 + (l - 0.52) * 0.3;
    // Тёмные заливки держим тёмными, иначе фон панелей всплывает.
    if (l < 0.3) { lightness = l * 0.66; chroma = Math.min(chroma, 0.3); }
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

/*
 * Приставка темы к готовому селектору.
 *
 * Класс темы стоит на том же узле, что и `.app-frame`, поэтому для правил,
 * которые с него начинаются, приставка приклеивается, а не добавляется
 * предком — иначе правило никогда не совпадёт.
 */
function prefixSelector(selector) {
  return selector
    .split(',')
    .map((part) => {
      const value = part.trim().replace(/\s+/g, ' ');
      if (!value) return '';
      if (value === ':root') return '.appearance-crimson';
      if (value.startsWith('.app-frame')) return value.replace('.app-frame', '.app-frame.appearance-crimson');
      if (value.startsWith('.appearance-crimson')) return value;
      return `.appearance-crimson ${value}`;
    })
    .filter(Boolean)
    .join(',\n');
}

function isSkipped(selector) {
  if (/\.appearance-(graphite|crimson)\b/.test(selector)) return true;
  return KEEP_ORIGINAL.some((mark) => selector.includes(mark));
}

/** Основной стиль без созданного блока темы. */
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
      Из-за них в «Обзоре» заголовок залился сплошным прямоугольником вместо
      градиентных букв: сокращённая запись background сбрасывает все свойства
      семейства, которые в ней не указаны. В основном правиле рядом стояло
      background-clip: text, тема переопределяла только background — и обрезка
      по буквам пропадала, оставляя закрашенную плашку.
      Поэтому вместе с background переносим и его спутники.
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

/** Готовый текст блока темы вместе с рукописной частью. */
function buildBlock(css) {
  const rules = buildTheme(css);
  return [
    BEGIN,
    '/*',
    ' * Блок создан автоматически из основного стиля: каждое правило с цветом',
    ' * пересчитано в чёрно-красную гамму. Руками его не правят — при следующей',
    ' * сборке правки затрутся. Меняют либо основной стиль, либо пересчёт цвета',
    ' * в scripts/crimson-theme.cjs, а затем выполняют npm run theme:crimson.',
    ' */',
    ...rules,
    '',
    '/* Мерцание короны лучшего сервера. Ключевые кадры нельзя приписать теме',
    '   селектором, поэтому для неё заведён отдельный набор кадров. */',
    '@keyframes crown-glow-crimson {',
    '  0%, 100% { box-shadow: 0 3px 10px rgba(0,0,0,.5), 0 0 12px rgba(255,86,108,.3); }',
    '  50% { box-shadow: 0 3px 10px rgba(0,0,0,.5), 0 0 20px rgba(255,86,108,.55); }',
    '}',
    '.appearance-crimson .server-row.is-best .server-crown { animation-name: crown-glow-crimson; }',
    '',
    '/* Флаги стран, кружки выбора темы и чужие логотипы остаются цветными:',
    '   страну и марку узнают именно по цвету. */',
    '.appearance-crimson .server-flag-svg,',
    '.appearance-crimson .server-flag-svg * { filter: none; }',
    '',
    '/* Ровный чёрный корпус окна: заголовок, тело и подложки списков должны',
    '   совпадать по тону, иначе на стыке видна серая полоса. */',
    '.appearance-crimson,',
    '.appearance-crimson body { background: #0b0405; }',
    END,
  ].join('\n');
}

module.exports = { BEGIN, END, parseRules, repaint, buildTheme, buildBlock, stripGenerated, prefixSelector };
