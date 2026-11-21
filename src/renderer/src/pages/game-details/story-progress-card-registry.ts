/**
 * A route transition can temporarily keep more than one copy of the details
 * view mounted. Keep one story card per game in this renderer. When the owner
 * unmounts the next registered card takes over automatically.
 */
type Entry = {
  listener: (primary: boolean) => void;
};

export function createStoryProgressCardRegistry() {
  const cards = new Map<string, Entry[]>();

  return {
    register(gameKey: string, listener: Entry["listener"]) {
      const entry: Entry = { listener };
      const active = cards.get(gameKey) ?? [];
      active.push(entry);
      cards.set(gameKey, active);
      active.forEach((item, index) => item.listener(index === 0));

      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        const remaining = (cards.get(gameKey) ?? []).filter(
          (item) => item !== entry
        );
        if (remaining.length) cards.set(gameKey, remaining);
        else cards.delete(gameKey);
        remaining.forEach((item, index) =>
          item.listener(index === 0)
        );
      };
    },
  };
}

export const storyProgressCardRegistry = createStoryProgressCardRegistry();
