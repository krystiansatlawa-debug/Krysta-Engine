import type { Game, UserAchievement } from "@types";

type Marker = {
  id: string;
  alias?: string;
  chapter?: number;
  finale?: boolean;
};

type Campaign = {
  titles: readonly string[];
  markers: readonly Marker[];
  chapters?: number;
  chapterUnit?: "memory sequence" | "episode";
};

const range = (from: number, to: number, format: (value: number) => string) =>
  Array.from({ length: to - from + 1 }, (_, index) => format(from + index));

const numericId = (value: number) => String(value).padStart(3, "0");
const marks = (ids: readonly string[]): Marker[] => ids.map((id) => ({ id }));
const last = (id: string, alias?: string): Marker => ({
  id,
  alias,
  finale: true,
});
const chapterMarks = (
  start: number,
  to: number,
  format: (value: number) => string
) =>
  range(1, to, (chapter) => format(chapter + start - 1)).map((id, index) => ({
    id,
    chapter: index + 1,
  }));

// Main-campaign unlocks from each game's Steam achievement schema. Named aliases
// also cover Ubisoft accounts, which expose their own IDs instead of Steam's.
const campaigns = new Map<string, Campaign>([
  ["1259420", { titles: ["days gone"], markers: [{ id: "title:Just a Flesh Wound", alias: "Just a Flesh Wound" }, { id: "title:Special Delivery", alias: "Special Delivery" }, { id: "title:The Ends and the Means", alias: "The Ends and the Means" }, { id: "title:Lost and Found", alias: "Lost and Found" }, { id: "title:Brothers in Arm", alias: "Brothers in Arm" }, { id: "title:Take Back Your Name", alias: "Take Back Your Name" }, { id: "title:Riding NOMAD", alias: "Riding NOMAD" }, { id: "title:Hold on Tight", alias: "Hold on Tight" }, { id: "title:It's Getting Cold Outside", alias: "It's Getting Cold Outside" }, { id: "title:Morior Invictus", alias: "Morior Invictus" }, last("title:I've Been Waiting for This", "I've Been Waiting for This")] }],
  ["292030", { titles: ["the witcher 3 wild hunt","the witcher 3 wild hunt complete edition","the witcher 3 wild hunt game of the year edition"], markers: [{ id: "title:Lilac and Gooseberries", alias: "Lilac and Gooseberries" }, { id: "title:A Friend in Need", alias: "A Friend in Need" }, { id: "title:Family Counselor", alias: "Family Counselor" }, { id: "title:Something More", alias: "Something More" }, { id: "title:Xenonaut", alias: "Xenonaut" }, { id: "title:The King is Dead", alias: "The King is Dead" }, last("title:Passed the Trial", "Passed the Trial")] }],
  ["1593500", { titles: ["god of war"], markers: [{ id: "title:The Journey Begins", alias: "The Journey Begins" }, { id: "title:A New Friend", alias: "A New Friend" }, { id: "title:Feels Like Home", alias: "Feels Like Home" }, { id: "title:Dragon Slayer", alias: "Dragon Slayer" }, { id: "title:Troubling Consequences", alias: "Troubling Consequences" }, { id: "title:Hello, Old Friend", alias: "Hello, Old Friend" }, { id: "title:Promise Fulfilled", alias: "Promise Fulfilled" }, { id: "title:Round 2", alias: "Round 2" }, { id: "title:Past Haunts", alias: "Past Haunts" }, { id: "title:Twilight Beckons", alias: "Twilight Beckons" }, last("title:Last Wish", "Last Wish")] }],
  ["1888930", { titles: ["the last of us part i"], markers: [, last("title:No Matter What", "No Matter What")] }],
  ["1817070", { titles: ["marvel s spider man remastered"], markers: [, last("title:End Game", "End Game")] }],
  [
    "242050",
    {
      titles: ["assassin s creed iv black flag"],
      chapters: 13,
      chapterUnit: "memory sequence",
      markers: [
        ...chapterMarks(1, 12, (value) => `ACBF_Ach_${value}`),
        { ...last("ACBF_Ach_13", "Saw That One Coming..."), chapter: 13 },
      ],
    },
  ],
  [
    "911400",
    {
      titles: [
        "assassin s creed iii remastered",
        "assassin s creed 3 remastered",
      ],
      chapters: 12,
      markers: [
        ...range(36, 45, (value) => `AC3Remaster_Ach_${value}`).map(
          (id, index) => ({ id, chapter: index + 2 })
        ),
        { ...last("AC3Remaster_Ach_46", "The Sum of Truth"), chapter: 12 },
      ],
    },
  ],
  [
    "3035570",
    {
      titles: ["assassin s creed mirage"],
      markers: [
        { id: "ACMirage_Ach_1", alias: "The Master Thief of Anbar" },
        { id: "ACMirage_Ach_3", alias: "The Blood of a Ghoul" },
        ...marks(range(4, 6, (value) => `ACMirage_Ach_${value}`)),
        { id: "ACMirage_Ach_7", alias: "The Head of the Snake" },
        last("ACMirage_Ach_8", "Bal kullun mumkin"),
      ],
    },
  ],
  [
    "3159330",
    {
      titles: ["assassin s creed shadows"],
      chapters: 3,
      markers: [
        { id: "ACShadows_Ach_1", alias: "Prologue" },
        { id: "ACShadows_Ach_2", alias: "A New League Rises", chapter: 1 },
        { id: "ACShadows_Ach_3", alias: "An Oath Fulfilled", chapter: 2 },
        { id: "ACShadows_Ach_4", alias: "Fall of the Shinbakufu", chapter: 3 },
        last("ACShadows_Ach_5", "Epilogue"),
      ],
    },
  ],
  [
    "289650",
    {
      titles: ["assassin s creed unity"],
      chapters: 12,
      chapterUnit: "memory sequence",
      markers: [
        { id: "ACU_Ach_1", alias: "A Long Time Ago" },
        ...chapterMarks(2, 11, (value) => `ACU_Ach_${value}`),
        { ...last("ACU_Ach_13", "Curtain Call"), chapter: 12 },
      ],
    },
  ],
  [
    "368500",
    {
      titles: ["assassin s creed syndicate"],
      chapters: 9,
      chapterUnit: "memory sequence",
      markers: [
        ...chapterMarks(1, 8, (value) => `ACSyn_Ach_${value}`),
        { ...last("ACSyn_Ach_9", "Shall We Dance?"), chapter: 9 },
      ],
    },
  ],
  [
    "812140",
    {
      titles: ["assassin s creed odyssey"],
      chapters: 9,
      chapterUnit: "episode",
      markers: [
        ...chapterMarks(2, 8, numericId),
        { ...last("010", "Odyssey's End"), chapter: 9 },
      ],
    },
  ],
  [
    "582160",
    {
      titles: ["assassin s creed origins"],
      markers: [
        { id: "001", alias: "First Steps" },
        ...marks(range(2, 10, numericId)),
        last("011", "The End"),
      ],
    },
  ],
  [
    "2208920",
    {
      titles: ["assassin s creed valhalla"],
      markers: [
        { id: "ACValhalla_Ach_1", alias: "The Saga Begins" },
        { id: "ACValhalla_Ach_2", alias: "To England!" },
        { id: "ACValhalla_Ach_3", alias: "Hard Choices" },
        ...marks(range(4, 8, (value) => `ACValhalla_Ach_${value}`)),
        { id: "ACValhalla_Ach_10", alias: "As It Was Foretold" },
        { id: "ACValhalla_Ach_11", alias: "England Subdued" },
      ],
    },
  ],
  [
    "220240",
    {
      titles: ["far cry 3"],
      markers: [
        { id: "FarCry3_Ach_1", alias: "First Blood" },
        ...marks(range(2, 8, (value) => `FarCry3_Ach_${value}`)),
        { id: "FarCry3_Ach_9", alias: "Higher Than a Kite" },
        ...marks(["FarCry3_Ach_10", "FarCry3_Ach_11"]),
        last("FarCry3_Ach_12", "What a Trip"),
      ],
    },
  ],
  [
    "298110",
    {
      titles: ["far cry 4"],
      markers: [
        { id: "FarCry4_Ach_1", alias: "Welcome to Kyrat" },
        { id: "FarCry4_Ach_2", alias: "One Down" },
        { id: "FarCry4_Ach_5", alias: "Two Down" },
        { id: "FarCry4_Ach_7", alias: "Hat-Trick" },
        last("FarCry4_Ach_8", "The King Is Dead"),
      ],
    },
  ],
  [
    "371660",
    {
      titles: ["far cry primal"],
      markers: [
        { id: "FCPrimal_Ach_1", alias: "This Way To Oros" },
        ...marks(range(2, 5, (value) => `FCPrimal_Ach_${value}`)),
        { id: "FCPrimal_Ach_11", alias: "To Ash" },
        { id: "FCPrimal_Ach_12", alias: "Evolution in Action" },
      ],
    },
  ],
  [
    "552520",
    {
      titles: ["far cry 5"],
      markers: [
        { id: "FC5_Ach_1", alias: "The Spark" },
        ...marks(range(7, 10, (value) => `FC5_Ach_${value}`)),
        last("FC5_Ach_6", "Together Forever"),
      ],
    },
  ],
  [
    "939960",
    {
      titles: ["far cry new dawn"],
      markers: [
        { id: "FCNewDawn_Ach_1", alias: "The Meaning of Prosperity" },
        ...marks(range(2, 4, (value) => `FCNewDawn_Ach_${value}`)),
        last("FCNewDawn_Ach_5", "The End of Eden"),
      ],
    },
  ],
  [
    "2369390",
    {
      titles: ["far cry 6"],
      markers: [
        ...marks(range(3, 5, (value) => `FC6_Ach_${value}`)),
        last("FC6_Ach_6", "Viva La Revolución"),
      ],
    },
  ],
  [
    "35140",
    {
      titles: [
        "batman arkham asylum",
        "batman arkham asylum game of the year edition",
        "batman arkham asylum goty",
      ],
      markers: [
        ...marks(range(0, 14, (value) => `NEW_ACHIEVEMENT_1_${value}`)),
        ...range(15, 17, (value) => `NEW_ACHIEVEMENT_1_${value}`).map((id) =>
          last(id)
        ),
      ],
    },
  ],
  [
    "200260",
    {
      titles: [
        "batman arkham city",
        "batman arkham city goty",
        "batman arkham city game of the year edition",
      ],
      markers: [
        ...marks(range(0, 12, (value) => `NEW_ACHIEVEMENT_1_${value}`)),
        last("NEW_ACHIEVEMENT_1_13"),
      ],
    },
  ],
  [
    "209000",
    {
      titles: ["batman arkham origins"],
      markers: [
        ...marks(range(1, 5, (value) => `Achievement_${value}`)),
        last("Achievement_6"),
      ],
    },
  ],
  [
    "208650",
    {
      titles: ["batman arkham knight"],
      markers: [
        ...marks([
          "EACID_MP_Journey_into_Knight",
          "EACID_MP_As_the_Crow_Flies",
          "EACID_MP_Who_Rules_The_Night",
          "EACID_MP_A_Battle_Within",
        ]),
        last("EACID_MP_Master_of_Fear"),
      ],
    },
  ],
  [
    "12210",
    {
      titles: [
        "grand theft auto iv",
        "grand theft auto iv the complete edition",
      ],
      markers: [
        ...marks(["THETOUR", ...range(0, 4, (value) => `KEYMISSION${value}`)]),
        last("STORYDONE"),
      ],
    },
  ],
  [
    "1174180",
    {
      titles: ["red dead redemption 2"],
      markers: [
        ...marks(range(1, 9, (value) => `Achievement${value}`)),
        last("Achievement10"),
      ],
    },
  ],
  [
    "1091500",
    {
      titles: ["cyberpunk 2077", "cyberpunk 2077 ultimate edition"],
      markers: [
        ...marks([
          "TheFool",
          "TheLovers",
          "TheHermit",
          "TheWheelOfFortune",
          "TheHightPriestess",
        ]),
        last("TheWorld"),
      ],
    },
  ],
  [
    "271590",
    {
      titles: [
        "grand theft auto v",
        "grand theft auto v legacy",
        "grand theft auto v enhanced",
      ],
      markers: [
        ...marks([
          "ACH00",
          "ACH05",
          "ACH06",
          "ACH07",
          "ACH08",
          "ACH09",
          "ACH42",
        ]),
        last("ACH04"),
      ],
    },
  ],
]);

const storefrontAliases = new Map([["3240220", "271590"]]);
const normalizeTitle = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function matchUbisoftChapter(campaign: Campaign, achievement: UserAchievement) {
  if (!campaign.chapterUnit || !achievement.name.startsWith("ubisoft:"))
    return undefined;
  const match =
    /^complete (memory sequence|episode) (\d{1,2})( \+ epilogue)?[.!]?$/i.exec(
      (achievement.description ?? "").replace(/\s+/g, " ").trim()
    );
  if (match?.[1]?.toLowerCase() !== campaign.chapterUnit) return undefined;
  const marker = campaign.markers.find(
    (entry) => entry.chapter === Number(match[2])
  );
  // Odyssey's finale achievement requires both episode 9 and its epilogue.
  if (campaign.chapterUnit === "episode" && marker?.finale && !match[3])
    return undefined;
  return marker;
}

export interface StoryAchievementMilestone {
  title: string;
  chapter?: number;
  totalChapters?: number;
  finale: boolean;
}

type GameIdentity = Pick<Game, "shop" | "objectId" | "catalogueGame" | "title">;

export function getStoryAchievementMilestone(
  game: GameIdentity,
  achievements: readonly UserAchievement[] | null | undefined
): StoryAchievementMilestone | null {
  if (!achievements?.length || game.shop === "launchbox") return null;
  const steamId =
    game.shop === "steam"
      ? game.objectId
      : game.catalogueGame?.shop === "steam"
        ? game.catalogueGame.objectId
        : undefined;
  const title = normalizeTitle(game.title);
  const campaign = (steamId ? campaigns.get(storefrontAliases.get(steamId) ?? steamId) : undefined) ?? [...campaigns.values()].find((entry) => entry.titles.includes(title));
  if (!campaign) return null;

  const byId = new Map(
    campaign.markers.map((marker) => [marker.id.toLowerCase(), marker])
  );
  const byTitle = new Map(
    campaign.markers.flatMap((marker) =>
      marker.alias ? [[normalizeTitle(marker.alias), marker] as const] : []
    )
  );
  const priority = (value: Marker) =>
    value.finale ? Number.POSITIVE_INFINITY : (value.chapter ?? 0);
  let best: { marker: Marker; title: string; unlockTime: number } | undefined;
  for (const achievement of achievements) {
    if (
      achievement.unlocked !== true ||
      !achievement.displayName ||
      achievement.source === "retroachievements"
    )
      continue;
    const sourceId = achievement.sources?.find(
      (source) => source.shop === "steam" && source.objectId === steamId
    )?.name;
    const marker =
      byId.get((sourceId ?? achievement.name).toLowerCase()) ??
      byTitle.get(normalizeTitle(achievement.displayName)) ??
      matchUbisoftChapter(campaign, achievement);
    if (!marker) continue;
    const unlockTime = achievement.unlockTime ?? 0;
    if (
      best &&
      (priority(marker) < priority(best.marker) ||
        (priority(marker) === priority(best.marker) &&
          unlockTime <= best.unlockTime))
    )
      continue;
    best = { marker, title: achievement.displayName, unlockTime };
  }

  if (!best) return null;
  return {
    title: best.title,
    chapter: best.marker.chapter,
    totalChapters: campaign.chapters,
    finale: best.marker.finale === true,
  };
}
