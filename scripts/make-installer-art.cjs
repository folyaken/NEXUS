#!/usr/bin/env node
/**
 * Рисует картинки для окна установщика.
 *
 * Зачем. Установщик показывал стандартную заставку NSIS — синеватую картинку
 * из комплекта, которая к NEXUS отношения не имеет. Первое, что видит человек
 * после скачивания, выглядело чужим и дешёвым.
 *
 * NSIS принимает только BMP и жёстко задаёт размеры: боковая панель 164×314,
 * шапка 150×57. Другие размеры молча обрезаются, поэтому они прописаны здесь
 * константами, а не берутся из исходника.
 *
 * Файлы попадают в build/ и подключаются через package.json (installerSidebar,
 * uninstallerSidebar, installerHeader). Запускается автоматически перед сборкой.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');

// Размеры продиктованы NSIS: менять нельзя, иначе картинка обрежется.
const SIDEBAR = { width: 164, height: 314 };
const HEADER = { width: 150, height: 57 };

/** Фирменный знак NEXUS — та же лента, что в интерфейсе и на значке. */
function markSvg(size, opacity = 1) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="ribbon" x1="106" y1="156" x2="404" y2="361" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#7cf2d5"/><stop offset="0.5" stop-color="#8bf2b0"/><stop offset="1" stop-color="#39bf7b"/>
      </linearGradient>
      <linearGradient id="violet" x1="130" y1="150" x2="380" y2="370" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#b49cff"/><stop offset="1" stop-color="#7658e8"/>
      </linearGradient>
    </defs>
    <g opacity="${opacity}">
      <path d="M107 301V218l60-61 89 99 89-99 60 61v83l-60 61-89-99-89 99-60-61Z" fill="none" stroke="url(#violet)" stroke-width="55" stroke-linecap="square" stroke-linejoin="bevel" opacity=".9" transform="translate(0 12)"/>
      <path d="M107 301V218l60-61 89 99 89-99 60 61v83l-60 61-89-99-89 99-60-61Z" fill="none" stroke="url(#ribbon)" stroke-width="42" stroke-linecap="square" stroke-linejoin="bevel"/>
      <circle cx="256" cy="256" r="18" fill="#8cf1b2" stroke="#c6f8d8" stroke-width="4"/>
    </g>
  </svg>`;
}

/**
 * Боковая панель мастера установки.
 *
 * Тёмный фон под цвет интерфейса, знак и название — так окно установки
 * выглядит продолжением программы, а не чужим диалогом Windows.
 */
function sidebarSvg() {
  const { width, height } = SIDEBAR;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#141b2a"/><stop offset="0.55" stop-color="#0d1320"/><stop offset="1" stop-color="#181233"/>
      </linearGradient>
      <radialGradient id="glowA" cx="0.25" cy="0.18" r="0.6">
        <stop offset="0" stop-color="#7cf2d5" stop-opacity="0.22"/><stop offset="1" stop-color="#7cf2d5" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="glowB" cx="0.85" cy="0.85" r="0.6">
        <stop offset="0" stop-color="#8b6cff" stop-opacity="0.26"/><stop offset="1" stop-color="#8b6cff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <rect width="${width}" height="${height}" fill="url(#glowA)"/>
    <rect width="${width}" height="${height}" fill="url(#glowB)"/>
    <g stroke="#8ca1ff" stroke-opacity="0.07" stroke-width="1">
      ${Array.from({ length: 8 }, (_, i) => `<line x1="0" y1="${28 + i * 38}" x2="${width}" y2="${28 + i * 38}"/>`).join('')}
    </g>
    <text x="${width / 2}" y="228" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="25" font-weight="700" letter-spacing="4" fill="#eaf3ff">NEXUS</text>
    <text x="${width / 2}" y="248" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="8.5" letter-spacing="2.4" fill="#7f8ea8">NETWORK CONTROL</text>
    <rect x="${width / 2 - 26}" y="262" width="52" height="2" rx="1" fill="#7cf2d5" fill-opacity="0.55"/>
  </svg>`;
}

/** Шапка остальных страниц мастера: знак слева, тёмная подложка. */
function headerSvg() {
  const { width, height } = HEADER;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="hbg" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#131a28"/><stop offset="1" stop-color="#171233"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#hbg)"/>
    <rect x="0" y="${height - 2}" width="${width}" height="2" fill="#7cf2d5" fill-opacity="0.5"/>
  </svg>`;
}


/**
 * Сохраняет пиксели в 24-битный BMP.
 *
 * sharp умеет читать что угодно, но записывать BMP не умеет вовсе, а NSIS
 * принимает только его. Формат простой, поэтому заголовок собирается вручную:
 * строки идут снизу вверх, порядок каналов BGR, каждая строка дополняется
 * нулями до кратности четырём байтам.
 */
function writeBmp(filePath, pixels, width, height) {
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
      body[target++] = pixels[at + 2];
      body[target++] = pixels[at + 1];
      body[target++] = pixels[at];
    }
  }
  fs.writeFileSync(filePath, Buffer.concat([header, body]));
}

async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    // Картинки не критичны: без них установщик соберётся со стандартной
    // заставкой NSIS. Ронять сборку из-за оформления неправильно.
    console.log('Оформление установщика пропущено: пакет sharp не установлен.');
    console.log('Поставьте его один раз командой: npm install --no-save sharp');
    return;
  }

  fs.mkdirSync(buildDir, { recursive: true });

  // Боковая панель: фон и поверх него знак.
  const mark = await sharp(Buffer.from(markSvg(96))).png().toBuffer();
  const sidebar = await sharp(Buffer.from(sidebarSvg()))
    .composite([{ input: mark, top: 92, left: Math.round((SIDEBAR.width - 96) / 2) }])
    .removeAlpha()
    .raw()
    .toBuffer();
  writeBmp(path.join(buildDir, 'installer-sidebar.bmp'), sidebar, SIDEBAR.width, SIDEBAR.height);

  // Шапка: маленький знак у левого края.
  const smallMark = await sharp(Buffer.from(markSvg(40))).png().toBuffer();
  const header = await sharp(Buffer.from(headerSvg()))
    .composite([{ input: smallMark, top: Math.round((HEADER.height - 40) / 2), left: 12 }])
    .removeAlpha()
    .raw()
    .toBuffer();
  writeBmp(path.join(buildDir, 'installer-header.bmp'), header, HEADER.width, HEADER.height);

  for (const name of ['installer-sidebar.bmp', 'installer-header.bmp']) {
    const size = fs.statSync(path.join(buildDir, name)).size;
    console.log(`  ✓ build/${name} (${Math.round(size / 1024)} КБ)`);
  }
}

main().catch((error) => {
  console.log(`Оформление установщика пропущено: ${error.message}`);
});
