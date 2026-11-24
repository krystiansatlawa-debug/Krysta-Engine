export type FeaturedCandidate = { shop: string; objectId: string; title: string; libraryHeroImageUrl?: string | null; libraryImageUrl?: string | null };

export function selectFeatured<T extends FeaturedCandidate>(featured: T[], alternatives: T[], ownedKeys: ReadonlySet<string>, limit = 8): T[] {
  const unique = new Map<string, T>();
  for (const game of [...featured, ...alternatives]) {
    if (!game.title || !(game.libraryHeroImageUrl || game.libraryImageUrl)) continue;
    const key = `${game.shop}:${game.objectId}`;
    if (!unique.has(key)) unique.set(key, game);
  }
  const candidates = [...unique.values()];
  const unowned = candidates.filter(game => !ownedKeys.has(`${game.shop}:${game.objectId}`));
  const owned = candidates.filter(game => ownedKeys.has(`${game.shop}:${game.objectId}`));
  return [...unowned, ...owned].slice(0, limit);
}
