#!/usr/bin/env node
/**
 * Единый прогон всех регрессионных тестов NEXUS.
 * Запускает каждый tests/*.test.cjs в отдельном процессе и печатает сводку.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const testsDir = path.join(root, 'tests');

const only = process.argv.slice(2).filter((item) => !item.startsWith('--'));

const files = fs.readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.cjs'))
  .filter((name) => (only.length ? only.some((needle) => name.includes(needle)) : true))
  .sort();

if (!files.length) {
  console.error('Тесты не найдены.');
  process.exit(1);
}

const results = [];
const startedAt = Date.now();

for (const file of files) {
  const label = file.replace(/\.test\.cjs$/, '');
  const at = Date.now();
  const run = spawnSync(process.execPath, [path.join(testsDir, file)], { cwd: root, encoding: 'utf8' });
  const ms = Date.now() - at;
  const ok = run.status === 0;
  results.push({ label, ok, ms });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label} (${ms} ms)`);
  if (!ok) {
    const output = `${run.stdout || ''}${run.stderr || ''}`.trim();
    console.log(output.split('\n').map((line) => `        ${line}`).join('\n'));
  }
}

const failed = results.filter((item) => !item.ok);
const total = Date.now() - startedAt;
console.log(`\n${results.length - failed.length}/${results.length} наборов пройдено за ${total} ms`);
if (failed.length) {
  console.log(`Провалено: ${failed.map((item) => item.label).join(', ')}`);
  process.exit(1);
}
