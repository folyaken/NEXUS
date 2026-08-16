import type { AppLanguage } from './types';

/**
 * Перевод интерфейса.
 *
 * Русский текст остаётся исходным: он написан в коде и служит ключом. Так
 * ничего не теряется при добавлении новых строк — если перевода ещё нет,
 * показывается русский вариант, а не пустое место или технический ключ.
 *
 * Словарь намеренно плоский: ключ — русская фраза целиком. Это делает
 * добавление перевода механическим и не требует придумывать имена ключам.
 */

const EN: Record<string, string> = {
  // --- Навигация и общие действия --------------------------------------------
  'Главная': 'Home',
  'Обзор': 'Overview',
  'Логи': 'Logs',
  'Модули': 'Modules',
  'Журнал': 'Logs',
  'Настройки': 'Settings',
  'О программе': 'About',
  'Серверы': 'Servers',
  'Подписки': 'Subscriptions',
  'Добавить': 'Add',
  'Обновить': 'Refresh',
  'Отмена': 'Cancel',
  'Закрыть': 'Close',
  'Сохранить': 'Save',
  'Удалить': 'Delete',
  'Готово': 'Done',
  'Пинг': 'Ping',
  'Поиск': 'Search',

  // --- Главная страница --------------------------------------------------------
  'Открыть модули': 'Open modules',
  'Сканировать заново': 'Scan again',
  'Быстрый доступ': 'Quick access',
  'Все модули': 'All modules',
  'ВСЕГО МОДУЛЕЙ': 'TOTAL MODULES',
  'АКТИВНЫЕ': 'ACTIVE',
  'ЗДОРОВЬЕ': 'HEALTH',
  'ПОСЛЕДНИЙ СКАН': 'LAST SCAN',
  'обнаружено локально': 'found locally',
  'контур запущен': 'circuit running',
  'готовы к запуску': 'ready to start',
  'без критических ошибок': 'no critical errors',
  'автозапуск включён': 'autostart on',
  'автозапуск выключен': 'autostart off',

  // --- Состояния модулей --------------------------------------------------------
  'Запущен': 'Running',
  'Остановлен': 'Stopped',
  'Запускается': 'Starting',
  'Останавливается': 'Stopping',
  'Ошибка': 'Error',
  'В разработке': 'In development',
  'Обход DPI': 'DPI bypass',
  'Открывает YouTube, Discord и другие сайты без VPN.': 'Opens YouTube, Discord and other sites without a VPN.',
  'Возвращает доступ к Telegram, когда он заблокирован.': 'Restores access to Telegram when it is blocked.',

  // --- Настройки ---------------------------------------------------------------
  'Язык и оформление': 'Language and appearance',
  'Внешний вид всего приложения.': 'Appearance of the entire application.',
  'Язык интерфейса': 'Interface language',
  'Основной язык меню, подсказок и уведомлений.': 'Main language for menus, hints and notifications.',
  'Тема': 'Theme',
  'Комфортная тёмная тема для длительной работы.': 'A comfortable dark theme for long sessions.',
  'Тёмная': 'Dark',
  'Анимации': 'Animations',
  'Если движение в интерфейсе не работает, Windows отключил его для всех программ. Здесь это можно переопределить.':
    'If the interface looks frozen, Windows has disabled motion for every application. You can override that here.',
  'Включены': 'On',
  'Как в Windows': 'Follow Windows',
  'Выключены': 'Off',
  'Оформление': 'Accent',
  'Выберите характер акцентов интерфейса.': 'Choose the character of the interface accents.',
  'Индиго': 'Indigo',
  'Графит': 'Graphite',
  'Поведение NEXUS': 'NEXUS behaviour',
  'Общие действия приложения в Windows.': 'General application behaviour in Windows.',
  'Запускать вместе с Windows': 'Start with Windows',
  'NEXUS откроется в трее сразу после входа в систему.': 'NEXUS will open in the tray right after you sign in.',
  'Автозапуск модулей': 'Start modules automatically',
  'Запускать ранее включённые модули при старте приложения.': 'Start previously enabled modules when the application launches.',
  'Уведомления о событиях': 'Event notifications',
  'Показывать системные уведомления об ошибках и важных событиях.': 'Show system notifications about errors and important events.',
  'Закрывать в трей': 'Close to tray',
  'Крестик прячет окно. Полный выход доступен из меню трея.': 'The close button hides the window. Full exit is available from the tray menu.',
  'Настройки модулей разделены': 'Module settings live separately',
  'Параметры конкретного модуля открываются внутри его страницы. Здесь остаются только общие настройки NEXUS.':
    'Settings for a specific module open on its own page. Only general NEXUS settings stay here.',

  // --- Выбор приложений ---------------------------------------------------------
  'Выберите приложение': 'Choose an application',
  'Поиск по имени или пути…': 'Search by name or path…',
  'Приложения': 'Applications',
  'Выбрать файлом': 'Choose a file',
  'Добавить выбранные': 'Add selected',
  'Уже добавлено': 'Already added',

  // --- Обновление ---------------------------------------------------------------
  'Проверить обновления': 'Check for updates',
  'Установить обновление': 'Install update',
  'Скачать обновление': 'Download update',
  'У вас последняя версия': 'You have the latest version',
  'Доступно обновление': 'An update is available',
};

const DICTIONARIES: Record<AppLanguage, Record<string, string>> = {
  ru: {},
  en: EN,
};

/**
 * Возвращает функцию перевода для выбранного языка.
 *
 * Неизвестная строка возвращается как есть: пользователь увидит русский
 * оригинал вместо пустоты, а недостающий перевод заметен сразу.
 */
export function createTranslator(language: AppLanguage): (text: string) => string {
  const dictionary = DICTIONARIES[language] ?? {};
  return (text: string) => dictionary[text] ?? text;
}

/** Готов ли перевод строки — нужно тестам, чтобы находить пропуски. */
export function hasTranslation(language: AppLanguage, text: string): boolean {
  if (language === 'ru') return true;
  return Object.prototype.hasOwnProperty.call(DICTIONARIES[language] ?? {}, text);
}

export function translationKeys(language: AppLanguage): string[] {
  return Object.keys(DICTIONARIES[language] ?? {});
}
