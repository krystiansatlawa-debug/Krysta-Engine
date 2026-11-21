export interface GameStoryProgress {
  percent: number | null;
  missionName: string;
  missionDescription: string;
}

export interface AutomaticGameStoryProgress {
  percent: number | null;
  saveTitle: string;
  trackedQuestId?: string;
  summaryKey?: string;
  savedAt: number;
}

export type StorySaveStatus =
  | "ready"
  | "waiting"
  | "not-found"
  | "unreadable"
  | "save-found";

export interface GameStoryProgressView {
  manual: GameStoryProgress | null;
  automatic: AutomaticGameStoryProgress | null;
  automaticStatus: StorySaveStatus;
  lastSaveAt: number | null;
  hasCustomSaveFolder: boolean;
  canSelectSaveFolder: boolean;
}
