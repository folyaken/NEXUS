const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { COMMUNITY_LINKS, TELEGRAM_CHANNEL, isAllowedCommunityUrl } = require(path.join(root, 'dist-electron', 'community.js'));
const { buildPost, readChangelogSection } = require(path.join(root, 'scripts', 'release-post.cjs'));
const { hasTranslation } = require(path.join(root, 'dist-electron', 'i18n.js'));

// --- Адрес канала --------------------------------------------------------------
// Адрес живёт в одном месте: раньше подобные строки расползались по разметке, и
// при переименовании канала часть кнопок вела бы в никуда.
assert.match(TELEGRAM_CHANNEL, /^https:\/\/t\.me\/[A-Za-z0-9_]+$/, 'адрес канала должен быть ссылкой t.me по https');
assert.ok(COMMUNITY_LINKS.length >= 1, 'нужна хотя бы одна ссылка сообщества');
for (const link of COMMUNITY_LINKS) {
  assert.match(link.url, /^https:\/\//, `ссылка ${link.id} обязана быть https`);
  assert.ok(link.title.trim(), 'у ссылки должна быть подпись');
  assert.ok(link.description.trim(), 'у ссылки должно быть пояснение — иначе непонятно, зачем переходить');
}
assert.ok(COMMUNITY_LINKS.some((link) => link.url === TELEGRAM_CHANNEL), 'канал обязан быть среди ссылок');

// --- Проверка адреса перед открытием ------------------------------------------
// NEXUS всегда работает с правами администратора. `shell.openExternal` умеет
// запускать не только сайты, поэтому открывается лишь то, что перечислено в коде.
assert.equal(isAllowedCommunityUrl(TELEGRAM_CHANNEL), true);
for (const bad of [
  'file:///C:/Windows/System32/cmd.exe',
  'http://t.me/nexus_flex',
  'https://t.me/evil',
  'javascript:alert(1)',
  '',
  null,
  42,
]) {
  assert.equal(isAllowedCommunityUrl(bad), false, `нельзя открывать: ${String(bad)}`);
}

// --- Ссылка доступна из интерфейса ---------------------------------------------
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'App.tsx'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8');
assert.match(app, /<CommunityCard t=\{t\} \/>/, 'карточка сообщества должна быть на странице «О программе»');
assert.match(app, /openCommunityLink/, 'переход выполняет main-процесс, а не окно');
assert.doesNotMatch(app, /href="https:\/\/t\.me/, 'ссылка не должна открываться внутри окна программы');
// Из свёрнутой программы до раздела «О программе» ещё нужно дойти, поэтому
// канал продублирован в меню значка возле часов.
assert.match(main, /Новости и обновления в Telegram/, 'нужен пункт канала в меню трея');
assert.match(main, /ipcMain\.handle\('community:open'/);
assert.match(main, /isAllowedCommunityUrl\(url\)/, 'перед открытием адрес обязан проверяться');

// Английский интерфейс не должен внезапно показывать русские подписи.
for (const phrase of ['СООБЩЕСТВО', 'Канал NEXUS', ...COMMUNITY_LINKS.flatMap((link) => [link.title, link.description])]) {
  assert.equal(hasTranslation('en', phrase), true, `нужен перевод: «${phrase}»`);
}

// --- Пост о релизе --------------------------------------------------------------
// Пост писался каждый раз заново и выходил разным: то без ссылки, то
// техническими формулировками. Теперь он собирается из CHANGELOG.md.
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const section = readChangelogSection(version);
assert.ok(section, `в CHANGELOG.md нет раздела версии ${version}`);
assert.ok(section.groups.length, 'раздел версии пустой — посту нечего рассказать');

const post = buildPost(version, section);
assert.ok(post.includes(`NEXUS ${version}`), 'в посте должен быть номер версии');
assert.ok(post.includes('releases/latest'), 'в посте должна быть ссылка на установщик');
assert.ok(post.includes('«Проверить»'), 'в посте должно быть напоминание про обновление одной кнопкой');
// Telegram обрезает длинные подписи и портит вид ленты: пост держим компактным.
assert.ok(post.length < 3800, `пост слишком длинный: ${post.length} символов`);
// Пункты берутся из файла, а не выдумываются.
assert.ok(post.includes(section.groups[0].items[0]), 'пункты поста должны совпадать с CHANGELOG.md');

console.log('Community links and release post checks passed.');
