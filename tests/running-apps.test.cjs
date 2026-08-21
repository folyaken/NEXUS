const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { listRunningApps } = require(path.join(root, 'dist-electron', 'running-apps.js'));
const source = fs.readFileSync(path.join(root, 'src', 'main', 'running-apps.ts'), 'utf8');
const picker = fs.readFileSync(path.join(root, 'src', 'renderer', 'AppPicker.tsx'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src', 'renderer', 'Jey2RayPage.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');

// Выбирать программу файлом неудобно: нужно помнить путь установки и опознать
// её среди системных файлов. Добавлен привычный способ — список уже открытых
// программ со значками. Выбор файлом остаётся для закрытых программ.

// --- Сбор списка -------------------------------------------------------------
void (async () => {
  // На других системах список пуст, но приложение обязано продолжать работать:
  // пользователю остаётся выбор файлом.
  const apps = await listRunningApps();
  assert.ok(Array.isArray(apps), 'функция обязана возвращать список даже вне Windows');
  if (process.platform !== 'win32') assert.equal(apps.length, 0);

  console.log('Running apps checks passed.');
})();

// Службы Windows в списке не нужны: они не «приложения», а правила для них
// могут случайно увести системный трафик в туннель.
for (const service of ['svchost.exe', 'csrss.exe', 'lsass.exe', 'dwm.exe', 'RuntimeBroker.exe', 'explorer.exe']) {
  assert.match(source, new RegExp(`'${service.toLowerCase()}'`), `служба ${service} должна отсеиваться`);
}

// Показываются только программы с собственным окном — то, что человек считает
// приложением.
assert.match(source, /MainWindowHandle -ne 0/, 'берутся процессы с окном');
// Значок и понятное название: список должен читаться взглядом.
assert.match(source, /ExtractAssociatedIcon/, 'нужны значки программ');
assert.match(source, /FileDescription/, 'нужно человеческое название программы');

// Данные из системы не принимаются на веру: неверные пути и раздутые значки
// отбрасываются, иначе они попадут в настройки и в интерфейс.
assert.match(source, /MAX_ICON_CHARS/, 'размер значка обязан быть ограничен');
assert.match(source, /\/\^\[A-Za-z0-9\+\/=\]\+\$\//, 'значок принимается только как корректный base64');
assert.match(source, /\\.exe\$\/i\.test\(executable\)/, 'принимаются только исполняемые файлы');
assert.match(source, /timeout: LIST_TIMEOUT_MS/, 'опрос системы обязан прерываться по времени');

// --- Окно выбора -------------------------------------------------------------
// Два способа рядом: список открытых программ и выбор файлом.
assert.match(picker, /listRunningApps/, 'окно обязано читать список открытых программ');
assert.match(picker, /Выбрать файл…/, 'выбор файлом обязан остаться доступным');
assert.match(picker, /onBrowse/, 'кнопка выбора файлом обязана быть подключена');

// Можно отметить сразу несколько программ — иначе окно пришлось бы открывать
// по разу на каждую.
assert.match(picker, /aria-multiselectable="true"/);
// Подпись переводится, поэтому слово и счётчик собираются из t('Добавить').
assert.match(picker, /\$\{t\('Добавить'\)\} · \$\{picked\.size\}/, 'на кнопке видно количество выбранного');

// Уже добавленные программы нельзя выбрать повторно.
assert.match(picker, /Уже добавлено/);
assert.match(picker, /disabled=\{added\}/);

// Отказ системы не должен выглядеть поломкой: объясняем и предлагаем выход.
assert.match(picker, /Список открытых программ недоступен/);
assert.match(picker, /Открытых программ не найдено/);
assert.match(picker, /Ничего не найдено/);

// Клавиатура: Escape закрывает, Tab не выпускает фокус за пределы окна.
assert.match(picker, /event\.key === 'Escape'/);
assert.match(picker, /event\.key !== 'Tab'/, 'фокус обязан удерживаться внутри окна');
assert.match(picker, /role="dialog"/);
assert.match(picker, /aria-modal="true"/);

// Поиск и по названию, и по пути: программу ищут и так, и так.
assert.match(picker, /app\.title\.toLocaleLowerCase/);
assert.match(picker, /app\.path\.toLocaleLowerCase/);

// --- Подключение к странице ---------------------------------------------------
assert.match(page, /import AppPicker from '\.\/AppPicker'/);
assert.match(page, /setPickerRouting\(activate\)/, 'кнопка «Добавить приложение» открывает список');
assert.match(page, /mergeSplitApps/, 'выбранное обязано попадать в настройки');
// Ранее добавленные программы не должны исчезать при добавлении новых.
assert.match(page, /const merged = new Map\(splitApps\.map/);

// --- Оформление ---------------------------------------------------------------
// Панель обязана оставаться видимой при захвате экрана: размытые слои
// скриншотеры не копируют.
const pickerStyles = styles.slice(styles.indexOf('.app-picker-backdrop'));
assert.ok(pickerStyles.length > 0, 'стили окна обязаны присутствовать');
assert.doesNotMatch(pickerStyles, /backdrop-filter/, 'окно не должно использовать размытие');
assert.match(pickerStyles, /\.app-picker \{[^}]*background: #141c2a/, 'фон окна обязан быть сплошным');

// «Графит» больше не чёрно-белый: у него графитовый корпус и лавандовый
// акцент. Кнопка подтверждения — акцентная, значит она обязана быть лавандовой,
// иначе окно выбора программ выпадет из оформления.
assert.match(styles, /\.appearance-graphite \.app-picker-confirm \{ background: linear-gradient\(130deg, #c6b9f3, #cec2f5\)/);
assert.match(styles, /\.appearance-graphite \.app-picker-row\.is-picked/);
