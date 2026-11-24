import path from "node:path";

type RunningApplication = { pid: number; exe: string | null; name?: string };

type ApplicationActions = {
  list: () => Promise<RunningApplication[] | undefined>;
  protectedPaths: () => Promise<string[]>;
  close: (application: RunningApplication, executable: string) => boolean;
  reopen: (executable: string) => Promise<void>;
  reportError: (error: unknown) => void;
};

export const windowsExecutableKey = (value: string) =>
  path.win32.normalize(value.replace(/^\\\\\?\\/, "")).toLowerCase();

export const normalizeGameBoostApplicationPaths = (
  paths: unknown,
  limit: number
): string[] => {
  if (!Array.isArray(paths)) return [];

  const normalized = new Map<string, string>();
  for (const input of paths) {
    if (typeof input !== "string" || /[\0\r\n]/.test(input)) continue;
    const executable = path.win32.normalize(input.trim());
    if (!/^[a-z]:\\[^<>:"|?*]+\.exe$/i.test(executable)) continue;
    const key = windowsExecutableKey(executable);
    if (!normalized.has(key)) normalized.set(key, executable);
    if (normalized.size === limit) break;
  }
  return [...normalized.values()];
};

export class GameBoostApplications {
  private session: Set<string> | undefined;
  private selected = new Map<string, string>();
  private closed = new Map<string, string>();
  private restore = true;
  private tail = Promise.resolve();

  constructor(private readonly actions: ApplicationActions) {}

  sync(active: boolean, executables: string[], restore: boolean) {
    this.restore = restore;
    const previous = this.selected;
    this.selected = new Map(
      executables.map((executable) => [
        windowsExecutableKey(executable),
        executable,
      ])
    );

    if (!active) {
      if (!this.session && !this.closed.size) return;
      this.session = undefined;
      this.enqueue(() => this.reopenApplications());
      return;
    }

    const session = this.session ?? new Set<string>();
    const shouldClose =
      this.session !== session ||
      [...this.selected.keys()].some((key) => !previous.has(key));
    this.session = session;
    if (shouldClose && this.selected.size) {
      this.enqueue(() => this.closeApplications(session));
    }
  }

  async waitForIdle() {
    await this.tail;
  }

  async shutdown() {
    this.sync(false, [], this.restore);
    await this.tail;
  }

  private enqueue(operation: () => Promise<void>) {
    this.tail = this.tail.then(operation).catch(this.actions.reportError);
  }

  private async closeApplications(session: Set<string>) {
    if (this.session !== session) return;
    const [running, protectedPaths] = await Promise.all([
      this.actions.list(),
      this.actions.protectedPaths(),
    ]);
    if (this.session !== session || !running) return;

    const protectedKeys = new Set(protectedPaths.map(windowsExecutableKey));
    for (const [key, executable] of this.selected) {
      if (session.has(key) || protectedKeys.has(key)) continue;
      session.add(key);
      for (const application of running) {
        if (!application.exe || windowsExecutableKey(application.exe) !== key)
          continue;
        if (this.actions.close(application, executable))
          this.closed.set(key, executable);
      }
    }
  }

  private async reopenApplications() {
    if (this.session || this.closed.size === 0) return;
    if (!this.restore) {
      this.closed.clear();
      return;
    }

    const running = await this.actions.list();
    if (this.session || !running) return;
    const runningKeys = new Set(
      running.flatMap(({ exe }) => (exe ? [windowsExecutableKey(exe)] : []))
    );
    const unidentifiedNames = new Set(
      running.flatMap(({ exe, name }) =>
        !exe && name ? [name.toLowerCase().replace(/\.exe$/, "")] : []
      )
    );
    for (const [key, executable] of this.closed) {
      if (this.session) return;
      if (
        !this.restore ||
        runningKeys.has(key) ||
        unidentifiedNames.has(path.win32.basename(key, ".exe"))
      ) {
        this.closed.delete(key);
        continue;
      }
      try {
        await this.actions.reopen(executable);
        this.closed.delete(key);
      } catch (error) { this.actions.reportError(error); }
    }
  }
}
