export class PresentMonFps {
  private columns: {
    pid: number;
    chain: number;
    time: number;
    count: number;
  } | null = null;
  private readonly samples = new Map<
    string,
    { totalMs: number; frames: number }
  >();

  constructor(private readonly processId: number) {}

  addLine(line: string) {
    const row = line.trim().split(",");
    if (row[0] === "Application") {
      const pid = row.indexOf("ProcessID");
      const chain = row.indexOf("SwapChainAddress");
      const time = row.indexOf("MsBetweenPresents");
      this.columns =
        pid > 0 && chain > 0 && time > 0
          ? { pid, chain, time, count: row.length }
          : null;
      return;
    }

    const columns = this.columns;
    if (!columns || row.length < columns.count) return;
    // PresentMon writes the executable name as the first column without
    // escaping commas. Match by PID, counting past any commas in that name.
    const offset = row.length - columns.count;
    if (Number(row[columns.pid + offset]) !== this.processId) return;
    const address = row[columns.chain + offset];
    const ms = Number(row[columns.time + offset]);
    if (!address || !Number.isFinite(ms) || ms <= 0 || ms > 10000) return;

    const sample = this.samples.get(address) ?? { totalMs: 0, frames: 0 };
    sample.totalMs += ms;
    sample.frames++;
    this.samples.set(address, sample);
  }

  takeFps() {
    let best: { totalMs: number; frames: number } | undefined;
    for (const sample of this.samples.values()) {
      if (!best || sample.frames > best.frames) best = sample;
    }
    this.samples.clear();
    return best ? Math.round((1000 * best.frames) / best.totalMs) : null;
  }
}
