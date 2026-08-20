/**
 * Человеческое название версии Windows.
 *
 * Проблема. `os.release()` возвращает внутренний номер ядра, а не то, что
 * написано на коробке. У Windows 11 он равен `10.0.22631` — ядро осталось
 * десятым, изменился только номер сборки. Поэтому в разделе «О программе»
 * у всех показывалось «Windows 10», даже на одиннадцатой.
 *
 * Отличить их можно единственным способом: по номеру сборки. Всё, что 22000 и
 * выше, — это Windows 11. Так же поступает и сама Microsoft в своих
 * инструментах: отдельного признака в системе нет.
 */

/** Первая сборка Windows 11. Ниже — десятка. */
const WINDOWS_11_BUILD = 22000;

/**
 * Обновления Windows 11 и 10 различаются только сборкой, а пользователи
 * узнают их по названию вроде «24H2». Показываем его: так понятнее, о какой
 * именно системе речь, особенно когда человек присылает отчёт о проблеме.
 */
const WINDOWS_11_RELEASES: [number, string][] = [
  [26100, '24H2'],
  [22631, '23H2'],
  [22621, '22H2'],
  [22000, '21H2'],
];

const WINDOWS_10_RELEASES: [number, string][] = [
  [19045, '22H2'],
  [19044, '21H2'],
  [19043, '21H1'],
  [19042, '20H2'],
  [19041, '2004'],
  [18363, '1909'],
  [18362, '1903'],
  [17763, '1809'],
  [16299, '1709'],
  [15063, '1703'],
  [14393, '1607'],
  [10240, '1507'],
];

function releaseLabel(build: number, table: [number, string][]): string {
  for (const [since, label] of table) {
    if (build >= since) return label;
  }
  return '';
}

/**
 * Разбирает строку вида `10.0.22631` в понятное название.
 *
 * Значение принимается параметром, а не читается из `os` внутри: так функцию
 * можно проверить на всех вариантах систем, не запуская их.
 */
export function windowsVersionName(release: string): string {
  const parts = release.split('.');
  const major = Number(parts[0]);
  const minor = Number(parts[1] ?? 0);
  const build = Number(parts[2] ?? 0);

  if (!Number.isFinite(major)) return `Windows ${release}`;

  if (major === 10) {
    const isEleven = build >= WINDOWS_11_BUILD;
    const name = isEleven ? 'Windows 11' : 'Windows 10';
    const label = releaseLabel(build, isEleven ? WINDOWS_11_RELEASES : WINDOWS_10_RELEASES);
    // Номер сборки оставляем: по нему разработчику видно точную версию, когда
    // пользователь присылает отчёт о проблеме.
    return label ? `${name} ${label} (сборка ${build})` : `${name} (сборка ${build})`;
  }

  // Старые системы. Их поддержка не заявлена, но подпись должна быть честной,
  // а не «Windows 6.1».
  if (major === 6) {
    if (minor === 3) return 'Windows 8.1';
    if (minor === 2) return 'Windows 8';
    if (minor === 1) return 'Windows 7';
    return `Windows ${release}`;
  }

  // Будущие версии с другим номером ядра: показываем как есть, но без вранья
  // про десятку.
  return `Windows ${release}`;
}
