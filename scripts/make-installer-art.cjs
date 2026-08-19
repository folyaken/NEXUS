#!/usr/bin/env node
/**
 * Рисует картинки для окна установщика.
 *
 * Зачем. Установщик показывал стандартную заставку NSIS — синеватую картинку
 * из комплекта, которая к NEXUS отношения не имеет. Первое, что видит человек
 * после скачивания, выглядело чужим.
 *
 * Почему без библиотек. Первая версия рисовала через `sharp`, и это оказалось
 * плохим решением: пакет тянет за собой платформенные двоичные файлы, ставится
 * не везде и на чистой машине сборка молча оставалась без оформления. Здесь всё
 * рисуется вручную в буфере пикселей — нужен только Node. Ставить ничего не
 * надо, сборка не зависит от сети и от удачной установки лишнего пакета.
 *
 * NSIS принимает только BMP и жёстко задаёт размеры: боковая панель 164×314,
 * шапка 150×57. Другие размеры молча обрезаются, поэтому они заданы здесь
 * константами.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');

// Размеры продиктованы NSIS: менять нельзя, иначе картинка обрежется.
const SIDEBAR = { width: 164, height: 314 };
const HEADER = { width: 150, height: 57 };

// Сглаживание: рисуем в увеличенном масштабе и усредняем. Без него диагонали
// логотипа получаются рваными «лесенкой».
const SUPERSAMPLE = 3;

/** Холст с прямым доступом к пикселям. */
function createCanvas(width, height) {
  return { width, height, data: new Float64Array(width * height * 3) };
}

function mix(from, to, amount) {
  const k = Math.max(0, Math.min(1, amount));
  return [
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k,
    from[2] + (to[2] - from[2]) * k,
  ];
}

function blend(canvas, x, y, color, alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const at = (y * canvas.width + x) * 3;
  const a = Math.min(1, alpha);
  canvas.data[at] += (color[0] - canvas.data[at]) * a;
  canvas.data[at + 1] += (color[1] - canvas.data[at + 1]) * a;
  canvas.data[at + 2] += (color[2] - canvas.data[at + 2]) * a;
}

/** Диагональный градиент — основа фона. */
function fillDiagonal(canvas, stops) {
  const { width, height } = canvas;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const t = (x / width + y / height) / 2;
      let color = stops[0].color;
      for (let i = 0; i < stops.length - 1; i += 1) {
        const a = stops[i];
        const b = stops[i + 1];
        if (t >= a.at && t <= b.at) {
          color = mix(a.color, b.color, (t - a.at) / (b.at - a.at || 1));
          break;
        }
        if (t > b.at) color = b.color;
      }
      const at = (y * width + x) * 3;
      canvas.data[at] = color[0];
      canvas.data[at + 1] = color[1];
      canvas.data[at + 2] = color[2];
    }
  }
}

/** Мягкое пятно света: убирает ощущение плоской заливки. */
function addGlow(canvas, cx, cy, radius, color, strength) {
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const dx = (x - cx) / radius;
      const dy = (y - cy) / radius;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance >= 1) continue;
      const falloff = (1 - distance) ** 2;
      blend(canvas, x, y, color, falloff * strength);
    }
  }
}

/**
 * Отрезок с закруглёнными концами и сглаживанием.
 *
 * Все фигуры — логотип и буквы — собраны из таких отрезков: это проще и
 * предсказуемее, чем разбирать SVG-пути без библиотеки.
 */
function strokeLine(canvas, x1, y1, x2, y2, thickness, colorAt) {
  const half = thickness / 2;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - half - 1));
  const maxX = Math.min(canvas.width - 1, Math.ceil(Math.max(x1, x2) + half + 1));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - half - 1));
  const maxY = Math.min(canvas.height - 1, Math.ceil(Math.max(y1, y2) + half + 1));
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy || 1;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      const distance = Math.hypot(x - px, y - py);
      // Полтора пикселя на переход: край получается мягким, но не мыльным.
      const alpha = Math.max(0, Math.min(1, half - distance + 0.5));
      if (alpha <= 0) continue;
      blend(canvas, x, y, typeof colorAt === 'function' ? colorAt(t) : colorAt, alpha);
    }
  }
}

function strokePath(canvas, points, thickness, colorAt) {
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const shift = points.length > 1 ? i / (points.length - 1) : 0;
    strokeLine(canvas, x1, y1, x2, y2, thickness, typeof colorAt === 'function'
      ? (t) => colorAt((shift + t / (points.length - 1)))
      : colorAt);
  }
}

const MINT = [124, 242, 213];
const GREEN = [57, 191, 123];
const VIOLET = [150, 124, 255];
const DEEP_VIOLET = [118, 88, 232];

/**
 * Фирменный знак: угловатая лента в форме буквы N, переходящая в бесконечность.
 * Тот же силуэт, что у значка в интерфейсе и в brand/nexus-symbol.svg.
 */
function drawMark(canvas, cx, cy, size) {
  const unit = size / 100;
  const ribbon = [
    [-42, 8], [-24, -12], [0, 12], [24, -12], [42, 8],
    [24, 28], [0, 4], [-24, 28], [-42, 8],
  ].map(([x, y]) => [cx + x * unit, cy + y * unit]);

  // Фиолетовая тень под лентой даёт объём.
  strokePath(canvas, ribbon.map(([x, y]) => [x, y + 3.4 * unit]), 13 * unit, (t) => mix(VIOLET, DEEP_VIOLET, t));
  // Основная лента: мятный переходит в зелёный.
  strokePath(canvas, ribbon, 10 * unit, (t) => mix(MINT, GREEN, t));
  // Светлый блик по верхней грани.
  strokePath(canvas, [[-38, 4], [-24, -9], [0, 15], [24, -9], [38, 4]].map(([x, y]) => [cx + x * unit, cy + y * unit]),
    1.5 * unit, [214, 252, 228]);
}

/** Буквы рисуются штрихами: подключать шрифт ради пяти символов незачем. */
const GLYPHS = {
  N: [[[0, 1], [0, 0], [1, 1], [1, 0]]],
  E: [[[1, 0], [0, 0], [0, 1], [1, 1]], [[0, 0.5], [0.78, 0.5]]],
  X: [[[0, 0], [1, 1]], [[1, 0], [0, 1]]],
  U: [[[0, 0], [0, 0.76], [0.28, 1], [0.72, 1], [1, 0.76], [1, 0]]],
  S: [[[1, 0.12], [0.72, 0], [0.28, 0], [0, 0.2], [0.1, 0.42], [0.9, 0.6], [1, 0.8], [0.72, 1], [0.28, 1], [0, 0.88]]],
};

function drawText(canvas, text, startX, baseY, glyphWidth, glyphHeight, spacing, thickness, color) {
  let cursor = startX;
  for (const letter of text) {
    const strokes = GLYPHS[letter];
    if (strokes) {
      for (const stroke of strokes) {
        strokePath(
          canvas,
          stroke.map(([x, y]) => [cursor + x * glyphWidth, baseY + y * glyphHeight]),
          thickness,
          color,
        );
      }
    }
    cursor += glyphWidth + spacing;
  }
  return cursor - spacing;
}

/**
 * Сохраняет холст в 24-битный BMP.
 *
 * NSIS принимает только этот формат. Он простой, поэтому заголовок собирается
 * вручную: строки идут снизу вверх, каналы в порядке BGR, каждая строка
 * дополняется нулями до кратности четырём байтам.
 */
function writeBmp(filePath, canvas) {
  const { width, height, data } = canvas;
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelBytes = rowSize * height;
  const header = Buffer.alloc(54);
  header.write('BM', 0, 'ascii');
  header.writeUInt32LE(54 + pixelBytes, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(24, 28);
  header.writeUInt32LE(pixelBytes, 34);

  const body = Buffer.alloc(pixelBytes);
  for (let y = 0; y < height; y += 1) {
    const source = (height - 1 - y) * width * 3;
    let target = y * rowSize;
    for (let x = 0; x < width; x += 1) {
      const at = source + x * 3;
      body[target++] = Math.max(0, Math.min(255, Math.round(data[at + 2])));
      body[target++] = Math.max(0, Math.min(255, Math.round(data[at + 1])));
      body[target++] = Math.max(0, Math.min(255, Math.round(data[at])));
    }
  }
  fs.writeFileSync(filePath, Buffer.concat([header, body]));
}

/** Усреднение увеличенного холста до нужного размера. */
function downscale(canvas, factor) {
  const width = canvas.width / factor;
  const height = canvas.height / factor;
  const result = createCanvas(width, height);
  const total = factor * factor;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const at = ((y * factor + sy) * canvas.width + (x * factor + sx)) * 3;
          r += canvas.data[at];
          g += canvas.data[at + 1];
          b += canvas.data[at + 2];
        }
      }
      const at = (y * width + x) * 3;
      result.data[at] = r / total;
      result.data[at + 1] = g / total;
      result.data[at + 2] = b / total;
    }
  }
  return result;
}

function buildSidebar() {
  const k = SUPERSAMPLE;
  const canvas = createCanvas(SIDEBAR.width * k, SIDEBAR.height * k);
  fillDiagonal(canvas, [
    { at: 0, color: [20, 27, 42] },
    { at: 0.55, color: [13, 19, 32] },
    { at: 1, color: [24, 18, 51] },
  ]);
  addGlow(canvas, canvas.width * 0.25, canvas.height * 0.18, canvas.width * 0.9, MINT, 0.2);
  addGlow(canvas, canvas.width * 0.85, canvas.height * 0.86, canvas.width * 0.9, VIOLET, 0.24);

  // Тонкая сетка: намёк на «сетевую» тему. Рисуется напрямую с очень малой
  // непрозрачностью — через strokeLine линии выходили сплошными и яркими,
  // панель превращалась в тетрадный лист.
  for (let i = 0; i < 8; i += 1) {
    const y = Math.round((28 + i * 38) * k);
    for (let x = 0; x < canvas.width; x += 1) {
      for (let t = 0; t < k; t += 1) blend(canvas, x, y + t, [140, 161, 255], 0.05);
    }
  }

  drawMark(canvas, canvas.width / 2, 140 * k, 96 * k);

  // Название и подпись под ним.
  const glyphWidth = 17 * k;
  const spacing = 6 * k;
  const totalWidth = glyphWidth * 5 + spacing * 4;
  drawText(canvas, 'NEXUS', (canvas.width - totalWidth) / 2, 208 * k, glyphWidth, 22 * k, spacing, 3.1 * k, [234, 243, 255]);

  // Разделительная черта под названием.
  strokeLine(canvas, canvas.width / 2 - 26 * k, 258 * k, canvas.width / 2 + 26 * k, 258 * k, 2 * k, [124, 242, 213]);

  return downscale(canvas, k);
}

function buildHeader() {
  const k = SUPERSAMPLE;
  const canvas = createCanvas(HEADER.width * k, HEADER.height * k);
  fillDiagonal(canvas, [
    { at: 0, color: [19, 26, 40] },
    { at: 1, color: [23, 18, 51] },
  ]);
  addGlow(canvas, canvas.width * 0.16, canvas.height * 0.5, canvas.width * 0.6, MINT, 0.12);
  drawMark(canvas, 30 * k, HEADER.height / 2 * k, 40 * k);
  // Мятная кромка снизу связывает шапку с интерфейсом программы.
  strokeLine(canvas, 0, (HEADER.height - 1) * k, canvas.width, (HEADER.height - 1) * k, 2 * k, [124, 242, 213]);
  return downscale(canvas, k);
}

function main() {
  fs.mkdirSync(buildDir, { recursive: true });

  writeBmp(path.join(buildDir, 'installer-sidebar.bmp'), buildSidebar());
  writeBmp(path.join(buildDir, 'installer-header.bmp'), buildHeader());

  for (const name of ['installer-sidebar.bmp', 'installer-header.bmp']) {
    const size = fs.statSync(path.join(buildDir, name)).size;
    console.log(`  ✓ build/${name} (${Math.round(size / 1024)} КБ)`);
  }
}

if (require.main === module) main();

module.exports = { buildSidebar, buildHeader, writeBmp, SIDEBAR, HEADER };
