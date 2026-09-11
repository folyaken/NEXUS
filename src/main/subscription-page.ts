import { extractSubscriptionUrlFromClientLink, validateSubscriptionUrl } from './subscription';

/**
 * Чтение адреса подписки со страницы панели.
 *
 * Современные панели отдают не готовую страницу, а приложение, которое
 * рисует себя уже в браузере. В исходном тексте страницы нет ни ссылок, ни
 * кнопок — они появляются только после выполнения скриптов. Поэтому обычная
 * загрузка по сети видит пустую заготовку, и адрес подписки из неё извлечь
 * невозможно, сколько бы имён клиентских приложений мы ни перебрали.
 *
 * Здесь страница открывается в невидимом окне — том же движке, в котором
 * работает само приложение. Дальше со страницы читается ровно то, что увидел
 * бы человек: адрес за кнопкой «Добавить подписку» или «Получить ссылку».
 * Никаких действий на странице не выполняется, данные только считываются.
 */

/** Сколько ждать, пока страница построит содержимое. */
const PAGE_LOAD_TIMEOUT_MS = 20_000;
/** Пауза после загрузки: часть панелей дорисовывает кнопки не сразу. */
const PAGE_SETTLE_MS = 1_500;

/**
 * Скрипт, который выполняется внутри страницы.
 *
 * Возвращает все адреса, которые могут вести на конфигурацию: ссылки в
 * клиентские приложения, обычные ссылки и адреса, записанные простым текстом
 * (панели часто показывают их в поле «ваша ссылка»).
 */
const COLLECT_SCRIPT = `(() => {
  const out = [];
  const push = (value) => {
    if (typeof value === 'string' && value.length > 8 && value.length < 2048) out.push(value);
  };
  for (const element of document.querySelectorAll('a[href], button[data-url], [data-href], [data-link]')) {
    push(element.getAttribute('href'));
    push(element.getAttribute('data-url'));
    push(element.getAttribute('data-href'));
    push(element.getAttribute('data-link'));
  }
  for (const element of document.querySelectorAll('input, textarea')) {
    push(element.value);
  }
  const text = document.body ? document.body.innerText : '';
  const matches = text.match(/[a-z0-9-]+:\\/\\/[^\\s"'<>]+/gi);
  if (matches) for (const item of matches) push(item);
  return out.slice(0, 500);
})()`;

export interface SubscriptionPageReader {
  /** Открывает страницу и возвращает найденные на ней адреса. */
  collect(url: string): Promise<string[]>;
}

/**
 * Выбирает из собранных строк адрес, который действительно ведёт к
 * конфигурации.
 *
 * Приоритет у ссылок в клиентские приложения: панель кладёт в них точный
 * адрес. Затем — обычные адреса, похожие на подписку. Страница, с которой
 * начинали, отбрасывается: она уже проверена и ничего не дала.
 */
export function chooseSubscriptionCandidate(collected: readonly string[], pageUrl: string): string | null {
  const pageAddress = (() => {
    try {
      const url = new URL(pageUrl);
      url.hash = '';
      return url.toString().replace(/\/+$/, '');
    } catch {
      return pageUrl;
    }
  })();

  const isUsable = (value: string): boolean => {
    if (!/^https:\/\//i.test(value)) return false;
    if (value.replace(/\/+$/, '') === pageAddress) return false;
    try {
      validateSubscriptionUrl(value);
      return true;
    } catch {
      return false;
    }
  };

  // 1. Ссылки в клиентские приложения — самый надёжный источник.
  for (const item of collected) {
    if (!/^[a-z0-9-]+:\/\//i.test(item) || /^https?:\/\//i.test(item)) continue;
    const extracted = extractSubscriptionUrlFromClientLink(item);
    if (extracted && isUsable(extracted)) return extracted;
  }

  // 2. Обычные адреса, в которых панель называет формат подписки.
  const meaningful = /(?:sub|v2ray|xray|clash|mihomo|sing-?box|json|raw|happ|link)/i;
  for (const item of collected) {
    if (!isUsable(item)) continue;
    if (meaningful.test(item)) return item;
  }
  return null;
}

/**
 * Читает адрес подписки со страницы панели.
 *
 * Возвращает `null`, если страницу открыть не удалось или ничего похожего на
 * подписку на ней нет: тогда вызывающий код сообщит пользователю прежнюю
 * понятную ошибку, а не техническую подробность.
 */
export async function readSubscriptionUrlFromPage(
  pageUrl: string,
  log: (message: string) => void,
  reader: SubscriptionPageReader = electronPageReader(),
): Promise<string | null> {
  try {
    const collected = await reader.collect(pageUrl);
    if (!collected.length) return null;
    const candidate = chooseSubscriptionCandidate(collected, pageUrl);
    if (!candidate) return null;
    log('Адрес конфигурации получен со страницы панели.');
    return candidate;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'неизвестная ошибка';
    log(`Не удалось прочитать страницу панели: ${reason}`);
    return null;
  }
}

/**
 * Чтение страницы средствами приложения.
 *
 * Окно невидимо и полностью изолировано: без доступа к файлам, в отдельном
 * хранилище, которое удаляется сразу после чтения. Так открытие чужой
 * страницы не может повлиять на само приложение и не оставляет следов.
 */
function electronPageReader(): SubscriptionPageReader {
  return {
    async collect(url: string): Promise<string[]> {
      // Модуль загружается по требованию: без Electron (прогон тестов) файл
      // должен оставаться пригодным для импорта.
      const { BrowserWindow, session } = await import('electron');
      const target = validateSubscriptionUrl(url).toString();
      const partition = `nexus-subscription-${Date.now()}`;
      const isolated = session.fromPartition(partition, { cache: false });

      const window = new BrowserWindow({
        show: false,
        width: 1280,
        height: 900,
        webPreferences: {
          partition,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          javascript: true,
          webSecurity: true,
          images: false,
        },
      });

      // Страница не должна открывать новых окон и уводить пользователя куда-либо.
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('страница не ответила вовремя')), PAGE_LOAD_TIMEOUT_MS);
          const finish = () => { clearTimeout(timer); resolve(); };
          window.webContents.once('did-finish-load', finish);
          window.webContents.once('did-fail-load', (_event, _code, description) => {
            clearTimeout(timer);
            reject(new Error(description || 'страница не загрузилась'));
          });
          window.loadURL(target).catch((error: Error) => {
            clearTimeout(timer);
            reject(error);
          });
        });

        await new Promise((resolve) => setTimeout(resolve, PAGE_SETTLE_MS));
        const collected = await window.webContents.executeJavaScript(COLLECT_SCRIPT, true) as unknown;
        return Array.isArray(collected) ? collected.filter((item): item is string => typeof item === 'string') : [];
      } finally {
        if (!window.isDestroyed()) window.destroy();
        await isolated.clearStorageData().catch(() => undefined);
      }
    },
  };
}
