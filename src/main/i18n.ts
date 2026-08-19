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
  'с ошибкой': 'with errors',
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


  // --- Страницы и заголовки ----------------------------------------------------
  'Модули NEXUS': 'NEXUS modules',
  'Активные': 'Active',
  'Остановлены': 'Stopped',
  'Все': 'All',
  'Ничего не найдено': 'Nothing found',
  'Смените фильтр или просканируйте modules ещё раз.': 'Change the filter or scan the modules folder again.',
  'ФИЛЬТР:': 'FILTER:',
  'Манифесты из': 'Manifests from',
  'подключено': 'connected',
  'Сканировать': 'Scan',
  'Системные события NEXUS в реальном времени.': 'NEXUS system events in real time.',
  'Глобальные параметры языка, оформления и поведения NEXUS.': 'Global language, appearance and behaviour settings.',
  'Версии компонентов, сведения об устройстве и обновление NEXUS.': 'Component versions, device details and NEXUS updates.',
  'Сеть, которая': 'A network that',
  'остаётся под контролем.': 'stays under your control.',
  'Единый центр для спокойного управления сетевыми инструментами,': 'A single place to calmly manage network tools,',
  'локальными прокси и профилями маршрутизации.': 'local proxies and routing profiles.',

  // --- Карточка модуля ---------------------------------------------------------
  'Запустить': 'Start',
  'Остановить': 'Stop',
  'Подождите': 'Please wait',
  'Готов к запуску': 'Ready to start',
  'Скоро': 'Soon',
  'Интеграция будет добавлена в следующей версии.': 'This integration is coming in a future version.',
  'Профиль': 'Profile',
  'Изменить': 'Change',
  'Настройки модуля': 'Module settings',

  // --- Настройки модуля --------------------------------------------------------
  'НАСТРОЙКИ МОДУЛЯ': 'MODULE SETTINGS',
  'К модулям': 'Back to modules',
  'Вернуться к модулям': 'Back to modules',
  'Установленная версия модуля:': 'Installed module version:',
  'Свои сайты': 'Your own sites',
  'Список пуст': 'The list is empty',
  'Добавьте первый сайт, например instagram.com.': 'Add your first site, for example instagram.com.',
  'Достаточно основного домена — можно вставить и полную ссылку.': 'The main domain is enough — a full link works too.',
  'Поиск по списку…': 'Search the list…',
  'Адрес сайта': 'Site address',
  'Страница': 'Page',
  'Нужны права администратора': 'Administrator rights required',

  // --- Серверы и подписки ------------------------------------------------------
  'Сервер не выбран': 'No server selected',
  'Выберите сервер слева': 'Choose a server on the left',
  'Выключено': 'Off',
  'Подключено': 'Connected',
  'Подключение…': 'Connecting…',
  'Отключение…': 'Disconnecting…',
  'Диагностика': 'Diagnostics',
  'Ядро, процесс и порты': 'Core, process and ports',
  'Автоподключение выключено': 'Auto-connect is off',
  'Все серверы': 'All servers',
  'Серверы из всех доступных источников': 'Servers from every available source',
  'СЕРВЕРОВ': 'SERVERS',
  'ПОДПИСОК': 'SUBSCRIPTIONS',
  'ТЕКУЩАЯ ВЫБОРКА': 'CURRENT SELECTION',
  'Имя (необязательно)': 'Name (optional)',

  // --- Общие подписи -----------------------------------------------------------
  'Загрузка списка…': 'Loading the list…',
  'Проверяем…': 'Checking…',
  'Проверить': 'Check',
  'Проверить снова': 'Check again',
  'Скачать': 'Download',
  'Перезапустить и установить': 'Restart and install',
  'Свернуть боковую панель': 'Collapse the sidebar',
  'Развернуть боковую панель': 'Expand the sidebar',

  'О ПРОГРАММЕ': 'ABOUT NEXUS',
  'ВЕРСИЯ': 'VERSION',
  'УПРАВЛЕНИЕ СЕТЬЮ': 'NETWORK CONTROL PLANE',
  'СТАБИЛЬНАЯ ВЕРСИЯ': 'STABLE CHANNEL',
  'Для Windows': 'Desktop for Windows',
  'Быстрое управление VPN, маршрутами и локальными сетевыми модулями в одном аккуратном интерфейсе.':
    'Quick control over VPN, routing and local network modules in one tidy interface.',
  'Установленная версия модуля': 'Installed module version',

  'ЦЕНТР УПРАВЛЕНИЯ': 'CONTROL CENTER',
  'РЕЕСТР МОДУЛЕЙ': 'MODULE REGISTRY',
  'ПАРАМЕТРЫ NEXUS': 'NEXUS PREFERENCES',
  'КОНСОЛЬ СОБЫТИЙ': 'RUNTIME CONSOLE',
  'ВАШИ ИНСТРУМЕНТЫ': 'YOUR TOOLKIT',
  'УПРАВЛЕНИЕ ЛОКАЛЬНОЙ СЕТЬЮ': 'LOCAL NETWORK ORCHESTRATOR',


  // --- Страницы Jey2Ray, модулей и диалогов -------------------------------------
  'Автоподключение': 'Auto-connect',
  'Автоподключение и параметры модуля': 'Auto-connect and module options',
  'Адрес новой подписки': 'New subscription address',
  'Анимации интерфейса': 'Interface animations',
  'БЫСТРАЯ ПРОВЕРКА': 'QUICK CHECK',
  'Будет добавлен как': 'Will be added as',
  'ВКЛ': 'ON',
  'Ваше имя': 'Your name',
  'Введите имя': 'Enter a name',
  'Вернуться к серверам': 'Back to servers',
  'Версия NEXUS': 'NEXUS version',
  'Версия Xray Core': 'Xray Core version',
  'Версия sing-box': 'sing-box version',
  'Включить hostcase': 'Enable hostcase',
  'Включить hostdot': 'Enable hostdot',
  'Включить фрагментацию': 'Enable fragmentation',
  'Все прокси-запросы': 'All proxy requests',
  'Выберите общую политику. Конкретные приложения можно добавить ниже.': 'Choose the general policy. Specific applications can be added below.',
  'Выбранные приложения': 'Selected applications',
  'Выбранные приложения идут через VPN, все остальные — напрямую.': 'Selected applications go through the VPN, everything else connects directly.',
  'Выбранные приложения обходят VPN, все остальные идут через VPN.': 'Selected applications bypass the VPN, everything else goes through it.',
  'Выбрать файл…': 'Choose a file…',
  'Диагностика подключения': 'Connection diagnostics',
  'Добавить первую подписку': 'Add your first subscription',
  'Добавить подписку или отдельную ссылку': 'Add a subscription or a single link',
  'Дополнительные аргументы': 'Extra arguments',
  'Ещё не измеряли': 'Not measured yet',
  'Запускать последний сервер вместе с NEXUS.': 'Connect to the last server when NEXUS starts.',
  'Интервал панели': 'Panel interval',
  'Интерфейс NEXUS': 'NEXUS interface',
  'Исключения': 'Exceptions',
  'Источники логов': 'Log sources',
  'Источников': 'Sources',
  'КАНАЛ': 'CHANNEL',
  'Компьютер / ОС': 'Computer / OS',
  'Короткая проверка ядра, процесса, маршрутизации и портов.': 'A quick check of the core, process, routing and ports.',
  'ЛОКАЛЬНЫЙ ПРОФИЛЬ': 'LOCAL PROFILE',
  'Лицензии': 'Licenses',
  'Локальные порты': 'Local ports',
  'Локальный порт, который слушает модуль': 'Local port the module listens on',
  'Локальный профиль': 'Local profile',
  'Маршрутизация и выбранные программы': 'Routing and selected applications',
  'Модуль перезапустится автоматически': 'The module will restart automatically',
  'Модуль сейчас работает': 'The module is running',
  'Нажмите': 'Press',
  'Настроек пока нет': 'No settings yet',
  'Настройка приложений': 'Application setup',
  'Настройки Jey2Ray': 'Jey2Ray settings',
  'Настройки прокси для приложений': 'Proxy settings for applications',
  'Настройки сохраняются локально и привязаны к этому устройству.': 'Settings are stored locally and belong to this device.',
  'Новая подписка': 'New subscription',
  'Новые записи появятся здесь автоматически.': 'New entries will appear here automatically.',
  'Новые настройки вступят в силу после перезапуска модуля.': 'New settings take effect after the module restarts.',
  'ОБНОВЛЕНИЕ NEXUS': 'NEXUS UPDATE',
  'ОБЩИЕ НАСТРОЙКИ': 'GENERAL SETTINGS',
  'Обновить список': 'Refresh the list',
  'Обновление сетевых модулей': 'Network module updates',
  'Общие': 'General',
  'Основные параметры': 'Main options',
  'Остановите модуль, чтобы сменить профиль.': 'Stop the module to change the profile.',
  'Открытых программ не найдено': 'No running applications found',
  'Открыть настройки Jey2Ray': 'Open Jey2Ray settings',
  'Отменить': 'Cancel',
  'Отметьте программы из списка открытых или укажите файл вручную.': 'Pick applications from the running list or choose a file manually.',
  'Отчёт для поддержки': 'Support report',
  'Оформление NEXUS': 'NEXUS appearance',
  'Очистить поиск': 'Clear the search',
  'ПРАВОВАЯ ИНФОРМАЦИЯ': 'LEGAL INFORMATION',
  'По умолчанию': 'Default',
  'Повторить': 'Retry',
  'Повторы': 'Repeats',
  'Подготовка VPN-ядра': 'Preparing the VPN core',
  'Подписка https://… или vless:// hy2://': 'Subscription https://… or vless:// hy2://',
  'Подписок пока нет': 'No subscriptions yet',
  'Поиск по добавленным сайтам': 'Search added sites',
  'Поиск по названию или пути…': 'Search by name or path…',
  'Поиск приложения': 'Find an application',
  'Попробуйте другое название или добавьте программу файлом.': 'Try another name or add the application from a file.',
  'Порт не отвечает на TCP, но узел рабочий (часто Reality / Hysteria)': 'The port does not answer TCP, but the node works (common with Reality / Hysteria)',
  'Порт прокси': 'Proxy port',
  'Порт, на котором работает прокси, и набор обслуживаемых запросов.': 'The port the proxy runs on and the requests it serves.',
  'Последнее обновление': 'Last update',
  'Посмотреть текст': 'View the text',
  'Предыдущая страница': 'Previous page',
  'Приложения ещё не выбраны': 'No applications selected yet',
  'Проверенные репозитории GitHub': 'Verified GitHub repositories',
  'Проверить задержку всех серверов': 'Measure latency for all servers',
  'Проверка не выполнена': 'Check not performed',
  'Профили загружаются из релиза Zapret — доступны все, что в нём есть.': 'Profiles come from the Zapret release — every profile it ships is available.',
  'Профиль обхода': 'Bypass profile',
  'Процесс': 'Process',
  'Прямое подключение для выбранных приложений': 'Direct connection for selected applications',
  'РЕЖИМ': 'MODE',
  'Раздача в локальную сеть': 'Share with the local network',
  'Разделы настроек Jey2Ray': 'Jey2Ray settings sections',
  'Размер фрагмента': 'Fragment size',
  'Разработано для безопасной локальной работы': 'Built for safe local operation',
  'Режим маршрутизации приложений': 'Application routing mode',
  'Режим подключения': 'Connection mode',
  'Режим работы': 'Operating mode',
  'Русский': 'Russian',
  'СИСТЕМА': 'SYSTEM',
  'Свернуть': 'Collapse',
  'Секретная часть адреса скрыта': 'The secret part of the address is hidden',
  'Секреты скрыты': 'Secrets hidden',
  'Сервер': 'Server',
  'Серверов': 'Servers',
  'Серверов в подписках': 'Servers in subscriptions',
  'Системные настройки': 'System settings',
  'Следующая страница': 'Next page',
  'Событий пока нет': 'No events yet',
  'Сохранить профиль': 'Save profile',
  'Список открытых программ недоступен': 'The list of running applications is unavailable',
  'Стандартный режим. Через прокси идёт только Telegram.': 'Standard mode. Only Telegram goes through the proxy.',
  'Техническая информация': 'Technical information',
  'Только Telegram': 'Telegram only',
  'Только на устройстве': 'On this device only',
  'Тонкая настройка обхода для опытных пользователей': 'Fine-tuning the bypass for advanced users',
  'Трафик': 'Traffic',
  'Тёмная тема': 'Dark theme',
  'У этого модуля нет параметров — он работает сразу после запуска.': 'This module has no options — it works as soon as it starts.',
  'Удалить подписку?': 'Delete this subscription?',
  'Универсальный прокси: подойдёт для браузера и других программ.': 'Universal proxy: works for the browser and other applications.',
  'Управление подписками': 'Manage subscriptions',
  'Установить': 'Install',
  'ХРАНЕНИЕ': 'STORAGE',
  'Число повторов': 'Repeat count',
  'Читаем список открытых программ…': 'Reading the list of running applications…',
  'Что работает': 'What works',
  'Экспертные параметры': 'Expert options',
  'Это занимает несколько секунд.': 'This takes a few seconds.',
  'Это устройство': 'This device',
  'Ядро': 'Core',
  'активен': 'active',
  'без данных доступа': 'no access data',
  'включены': 'enabled',
  'локальный runtime': 'local runtime',
  'серверов': 'servers',

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
 * Общий переводчик для интерфейса.
 *
 * Язык хранится в одном месте, а экраны берут перевод функцией `t`. Так сделано
 * намеренно: передавать переводчик через свойства десятков вложенных
 * компонентов легко забыть, и один пропуск роняет всю страницу с ошибкой
 * «t is not defined» — так уже случалось с журналом событий.
 */
let activeLanguage: AppLanguage = 'ru';
let activeDictionary: Record<string, string> = {};

export function setInterfaceLanguage(language: AppLanguage): void {
  activeLanguage = language === 'en' ? 'en' : 'ru';
  activeDictionary = DICTIONARIES[activeLanguage] ?? {};
}

export function interfaceLanguage(): AppLanguage {
  return activeLanguage;
}

/** Перевод строки на выбранный язык. Неизвестная строка возвращается как есть. */
export function t(text: string): string {
  return activeDictionary[text] ?? text;
}

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
