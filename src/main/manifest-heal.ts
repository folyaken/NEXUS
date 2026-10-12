/**
 * Лечение «огрызков» манифестов.
 *
 * Апдейтер, не найдя манифест модуля, создаёт минималистичный: name равен id,
 * категория other. Такой модуль работает, но выглядит в реестре как «zapret»
 * вместо «Обход DPI». Здесь огрызок обогащается человеческими полями из
 * штатного манифеста, который едет в установщике, — рабочие поля (пути,
 * стратегии, версия) остаются от пользователя.
 */

export interface ManifestLike {
  id?: string;
  name?: string;
  category?: string;
  description?: string;
  icon?: string;
  [key: string]: unknown;
}

/** Похоже ли, что манифест — огрызок: имени нет или имя равно id. */
export function isStubManifest(manifest: ManifestLike): boolean {
  return !manifest.name || manifest.name === manifest.id;
}

/**
 * Возвращает манифест с человеческими полями из штатного, либо null,
 * если лечить нечего (это не огрызок или в штатном нет имени).
 */
export function healStubManifest(user: ManifestLike, bundled: ManifestLike): ManifestLike | null {
  if (!isStubManifest(user) || !bundled.name) return null;
  return {
    ...user,
    name: bundled.name,
    category: user.category && user.category !== 'other' ? user.category : bundled.category ?? user.category,
    description: user.description ?? bundled.description,
    icon: user.icon && user.icon !== '◈' ? user.icon : bundled.icon ?? user.icon,
  };
}
