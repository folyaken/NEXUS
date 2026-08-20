import { MAX_ROUTING_RULES, normalizeRoutingRules, type RoutingRule } from './routing-rules';

/**
 * Обмен наборами правил маршрутизации.
 *
 * Зачем. Настроенный набор правил — это работа: подобрать домены, расставить
 * порядок, проверить. Ей хочется делиться («набор для игр», «набор для
 * работы») и не терять при переустановке. Файл решает обе задачи.
 *
 * Формат намеренно простой и читаемый: обычный JSON, который можно открыть
 * блокнотом и поправить руками. Закрытый формат тут ничего не даёт, а
 * разобраться мешает.
 */

/** Метка формата: по ней отличаем свой файл от постороннего JSON. */
const FILE_KIND = 'nexus-routing-rules';
const FILE_VERSION = 1;

export interface RoutingRulesFile {
  kind: typeof FILE_KIND;
  version: number;
  /** Когда набор выгружен — помогает разобраться среди нескольких файлов. */
  exportedAt: string;
  rules: RoutingRule[];
}

/**
 * Готовит содержимое файла.
 *
 * Идентификаторы правил не сохраняются: они привязаны к устройству, где набор
 * создавали, и при переносе только мешают — на новой машине правила получат
 * свои. В файл идёт то, что важно: адрес, направление и включённость.
 */
export function exportRoutingRules(rules: RoutingRule[]): string {
  const payload: RoutingRulesFile = {
    kind: FILE_KIND,
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    rules: rules.map(({ value, outbound, enabled }) => ({ id: '', value, outbound, enabled })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export interface ImportOutcome {
  rules: RoutingRule[];
  /** Сколько правил пропущено: битые записи и повторы. */
  skipped: number;
  error?: string;
}

/**
 * Читает файл с правилами.
 *
 * Файл приходит извне — из мессенджера, с чужого компьютера, — поэтому к нему
 * нет доверия. Ошибка здесь дорого стоит: неверная строка в конфигурации не
 * даёт ядру запуститься, и VPN перестаёт подключаться без видимой причины.
 * Поэтому каждая запись проходит ту же проверку, что и ручной ввод, а негодные
 * молча отбрасываются вместо того, чтобы уронить весь импорт.
 */
export function importRoutingRules(text: string): ImportOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rules: [], skipped: 0, error: 'Файл повреждён или это не набор правил' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { rules: [], skipped: 0, error: 'Файл повреждён или это не набор правил' };
  }

  const source = parsed as Partial<RoutingRulesFile>;

  // Допускаем и голый список правил: человек мог сохранить только массив или
  // собрать файл руками. Отказывать из-за отсутствия обёртки — придирка.
  const rawRules = Array.isArray(parsed) ? parsed : source.rules;
  if (!Array.isArray(rawRules)) {
    return { rules: [], skipped: 0, error: 'В файле нет правил' };
  }

  if (!Array.isArray(parsed) && source.kind && source.kind !== FILE_KIND) {
    return { rules: [], skipped: 0, error: 'Это файл от другой программы' };
  }

  // Версия формата на будущее: если файл новее, чем эта сборка умеет читать,
  // честно об этом говорим, а не пытаемся угадать содержимое.
  if (typeof source.version === 'number' && source.version > FILE_VERSION) {
    return { rules: [], skipped: 0, error: 'Файл создан более новой версией NEXUS' };
  }

  const rules = normalizeRoutingRules(rawRules);
  const skipped = Math.max(0, rawRules.length - rules.length);

  if (!rules.length) {
    return { rules: [], skipped, error: 'В файле не оказалось подходящих правил' };
  }
  return { rules, skipped };
}

/**
 * Объединяет загруженный набор с текущим.
 *
 * Замена стёрла бы уже настроенное, поэтому правила добавляются к имеющимся.
 * Повторы пропускаются: одинаковое правило второй раз ничего не изменит —
 * сработает первое совпавшее.
 */
export function mergeRoutingRules(current: RoutingRule[], incoming: RoutingRule[]): { rules: RoutingRule[]; added: number } {
  const known = new Set(current.map((rule) => rule.value.toLowerCase()));
  const merged = [...current];
  let added = 0;

  for (const rule of incoming) {
    const key = rule.value.toLowerCase();
    if (known.has(key)) continue;
    if (merged.length >= MAX_ROUTING_RULES) break;
    known.add(key);
    merged.push({ ...rule, id: `rule-${Date.now().toString(36)}-${added}` });
    added += 1;
  }
  return { rules: merged, added };
}
