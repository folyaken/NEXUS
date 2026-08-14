const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'main', 'github-updater.ts'), 'utf8');

// --- Троттлинг прогресса загрузки -------------------------------------------
// Раньше событие обновления уходило в renderer на КАЖДЫЙ чанк потока. На
// 20-мегабайтном архиве это тысячи IPC-сообщений в секунду: React не успевал
// перерисовываться, окно подвисало, а процент застревал на первых значениях.
assert.match(source, /let lastEmitAt = 0;/, 'прогресс должен ограничиваться по времени');
assert.match(source, /now - lastEmitAt < 200/, 'между событиями прогресса нужен интервал не меньше 200 мс');
assert.match(source, /downloadedBytes - lastEmittedBytes/, 'событие должно уходить только при заметном сдвиге');
assert.doesNotMatch(
  source,
  /input\.on\('data', \(chunk: Buffer\) => \{\s*downloadedBytes \+= chunk\.length;\s*if \(target\) this\.setStatus/,
  'setStatus не должен вызываться напрямую на каждый чанк',
);

// Финальное состояние обязано отправляться принудительно, иначе полоса
// замирает на последнем троттлинг-значении и никогда не доходит до 100%.
assert.match(source, /emitProgress\(true\);/, 'по завершении загрузки нужен принудительный кадр прогресса');

// Счётчики сбрасываются перед новой загрузкой, иначе процент стартует с
// остатков предыдущего файла.
assert.match(source, /downloadedBytes: 0,/, 'счётчик байт должен обнуляться перед загрузкой');
assert.match(source, /totalBytes: asset\.size \|\| undefined,/, 'размер должен браться из метаданных релиза сразу');

// --- Защита от зависшего зеркала --------------------------------------------
// Источник, который принял соединение и «замолчал», раньше держал обновление
// бесконечно — индикатор оставался на первых процентах.
assert.match(source, /const STALL_TIMEOUT_MS = 20_000;/, 'нужен таймаут простоя загрузки');
assert.match(source, /armStallTimer\(\);/, 'таймер простоя должен перезапускаться на каждом чанке');
assert.match(source, /input\.destroy\(new Error\(`GitHub asset: источник не отвечает/, 'зависший источник должен браковаться');
assert.match(source, /clearTimeout\(stallTimer\);/, 'таймер обязан очищаться после загрузки');

// --- Контрольная сумма проверяется для каждого зеркала ----------------------
const mirrorLoop = source.slice(source.indexOf('for (const url of urls)'), source.indexOf('throw lastError;'));
assert.match(mirrorLoop, /Контрольная сумма GitHub asset/, 'сумма должна проверяться внутри перебора зеркал');

console.log('Update progress throttling and stall-guard checks passed.');
