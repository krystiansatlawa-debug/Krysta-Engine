/** Tracks local achievement-file observations separately for each game.
 * A shared source may represent several catalogue entries, so recording its
 * modification for one game must not suppress the other game's scan.
 */
export class AchievementFileObservationTracker {
  private readonly files = new Map<string, string>();
  private readonly folders = new Map<string, Set<string>>();

  private key(gameKey: string, filePath: string) {
    return JSON.stringify([gameKey, filePath]);
  }

  seedFile(gameKey: string, filePath: string, stat: {mtimeMs: number; size: number}) {
    this.files.set(this.key(gameKey, filePath), stat.mtimeMs + ":" + stat.size);
  }

  fileChanged(gameKey: string, filePath: string, stat: {mtimeMs: number; size: number}): boolean {
    const key = this.key(gameKey, filePath);
    const signature = stat.mtimeMs + ":" + stat.size;
    const previous = this.files.get(key);
    this.files.set(key, signature);
    return previous !== signature;
  }

  seedFolder(gameKey: string, filePath: string, entries: Iterable<string>) {
    this.folders.set(this.key(gameKey, filePath), new Set(entries));
  }

  folderChanged(gameKey: string, filePath: string, entries: Iterable<string>): boolean {
    const key = this.key(gameKey, filePath);
    const current = new Set(entries);
    const previous = this.folders.get(key);
    this.folders.set(key, current);
    if (!previous) return current.size > 0;
    return current.size !== previous.size || [...current].some(name => !previous.has(name));
  }

  forget(gameKey: string, filePath: string) {
    const key = this.key(gameKey, filePath);
    this.files.delete(key);
    this.folders.delete(key);
  }
}
