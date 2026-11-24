export type StoryMission = { title: string; chapter?: number; aliases?: readonly string[] };

const missions: Readonly<Record<string, readonly StoryMission[]>> = {
  gtav: [
    { title: "Prologue", aliases: ["Prolog"] },
    { title: "Franklin and Lamar", aliases: ["Franklin i Lamar"] },
    ...["Repossession", "Complications", "Chop", "Father/Son", "Marriage Counseling", "The Long Stretch", "Friend Request", "Casing the Jewel Store", "The Jewel Store Job", "Mr. Philips", "Nervous Ron", "Crystal Maze", "Blitz Play", "The Paleto Score", "The Bureau Raid", "The Big Score", "Something Sensible", "The Time's Come", "The Third Way"].map(title => ({ title })),
  ],
  rdr2: [
    ...["Outlaws from the West", "Enter, Pursued by a Memory", "Old Friends", "The Aftermath of Genesis", "Who the Hell is Leviticus Cornwall?", "Eastward Bound"].map(title => ({ title, chapter: 1 })),
    ...["Polite Society, Valentine Style", "Americans at Rest", "Exit Pursued by a Bruised Ego", "A Quiet Time", "The First Shall Be Last", "Pouring Forth Oil", "A Fisher of Men", "The Sheep and the Goats", "A Strange Kindness"].map(title => ({ title, chapter: 2 })),
    { title: "Red Dead Redemption", chapter: 6 },
  ],
  cyberpunk: [
    ...["The Ripperdoc", "The Ride", "The Information", "The Pickup", "The Heist", "Love Like Fire", "Playing for Time", "Automatic Love", "Ghost Town", "Down on the Street", "Search and Destroy", "Nocturne OP55N1"].map(title => ({ title })),
  ],
  gtaiv: ["The Cousins Bellic", "It's Your Call", "Three's a Crowd", "First Date", "Bleed Out", "Easy Fare", "Jamaican Heat", "Roman's Sorrow", "Three Leaf Clover", "Out of Commission", "A Revenger's Tragedy"].map(title => ({ title })),
};
const key = (value: string) => value.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "");
export function findStoryMission(source: string, title: string): StoryMission | undefined {
  const list = missions[source === "gtav-enhanced" ? "gtav" : source] ?? [];
  return list.find(mission => [mission.title, ...(mission.aliases ?? [])].some(alias => key(alias) === key(title)));
}
