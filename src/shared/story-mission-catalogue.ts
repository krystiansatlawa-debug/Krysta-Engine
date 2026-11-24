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

// Curated descriptions refer only to the named mission, not later outcomes.
const polishDescriptions: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  gtav: {
    "Blitz Play": "Bohaterowie przygotowują zasadzkę na transport opancerzony.",
    "The Paleto Score": "Ekipa podejmuje się napadu na bank w Paleto Bay.",
    "The Bureau Raid": "Michael i Franklin przygotowują operację w siedzibie FIB.",
    "The Big Score": "Bohaterowie przystępują do wielkiego skoku na Union Depository.",
  },
  rdr2: {
    "A Quiet Time": "Arthur i Lenny spędzają wieczór w saloonie w Valentine.",
    "A Fisher of Men": "Arthur zabiera Jacka na ryby.",
    "A Strange Kindness": "Gang szuka nowego miejsca na obóz.",
    "The Sheep and the Goats": "Arthur pomaga Johnowi przy przedsięwzięciu związanym z handlem owcami.",
  },
  cyberpunk: {
    "The Pickup": "V próbuje zdobyć robota Flathead od gangu Maelstrom.",
    "Nocturne OP55N1": "V udaje się na spotkanie z Hanako w Embers.",
  },
  gtaiv: {
    "The Cousins Bellic": "Niko przybywa do Liberty City i spotyka kuzyna Romana.",
    "It's Your Call": "Niko pomaga Romanowi podczas jego spraw w mieście.",
    "Three Leaf Clover": "Niko bierze udział w przygotowanym napadzie na bank.",
    "Easy Fare": "Niko wykonuje kurs dla firmy taksówkarskiej Romana.",
  },
};
export function findPolishStoryDescription(source: string, title: string): string | undefined {
  const mission = findStoryMission(source, title);
  return mission ? polishDescriptions[source === "gtav-enhanced" ? "gtav" : source]?.[mission.title] : undefined;
}
