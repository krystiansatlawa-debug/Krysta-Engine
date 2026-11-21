export interface GameJournalSession {
  id: string;
  startedAt: number;
  endedAt: number;
}

export interface GameJournalPage {
  sessions: GameJournalSession[];
  hasMore: boolean;
}
