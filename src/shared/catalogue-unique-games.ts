export function uniqueCatalogueGames<T extends {shop:string;objectId:string}>(games: readonly T[], limit = Infinity): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const game of games) {
    if (result.length >= limit) break;
    if (!game || typeof game.shop !== "string" || typeof game.objectId !== "string") continue;
    const key = JSON.stringify([game.shop,game.objectId]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(game);
  }
  return result;
}
