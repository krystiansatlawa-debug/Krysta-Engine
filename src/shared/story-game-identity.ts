export const normalizeStoryGameTitle = (title: string) =>
  title.toLowerCase().normalize("NFC").replace(/[’']/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function storyGameTitleCandidates(title: string): string[] {
  const exact = normalizeStoryGameTitle(title);
  const base = exact.replace(/(?:\s+(?:game of the year|goty|complete|ultimate|gold|deluxe|definitive|standard|collector s|anniversary)(?: edition)?)+$/, "").trim();
  return [...new Set([exact, base])].filter(Boolean);
}
