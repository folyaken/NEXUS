'use strict';

/*
 * Пересборка оформления «Багровое».
 *
 * Тема не пишется руками: она считается из основного стиля, чтобы новый экран
 * не остался неперекрашенным. Результат кладётся в отдельный файл
 * src/renderer/crimson.css — так основной styles.css остаётся читаемым, а тема
 * подключается после него и потому перекрывает базовые цвета без !important.
 */

const fs = require('node:fs');
const path = require('node:path');
const { buildBlock } = require('./crimson-theme.cjs');

const root = path.join(__dirname, '..', 'src', 'renderer');
const source = path.join(root, 'styles.css');
const target = path.join(root, 'crimson.css');

const css = fs.readFileSync(source, 'utf8');
fs.writeFileSync(target, `${buildBlock(css)}\n`);

const count = (fs.readFileSync(target, 'utf8').match(/\{/g) || []).length;
console.log(`Оформление «Багровое» пересобрано: ${count} правил -> src/renderer/crimson.css`);
