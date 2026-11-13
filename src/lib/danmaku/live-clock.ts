export class LiveDanmakuClock {
  private readonly wallNow: () => number;
  private pausedAtMs: number | null = null;
  private pausedDurationMs = 0;

  constructor(wallNow: () => number = () => performance.now()) {
    this.wallNow = wallNow;
  }

  isPaused() {
    return this.pausedAtMs !== null;
  }

  pause() {
    if (this.pausedAtMs === null) {
      this.pausedAtMs = this.wallNow();
    }
  }

  resume() {
    if (this.pausedAtMs === null) return;
    this.pausedDurationMs += Math.max(0, this.wallNow() - this.pausedAtMs);
    this.pausedAtMs = null;
  }

  now() {
    const wallTime =
      this.pausedAtMs === null ? this.wallNow() : this.pausedAtMs;
    return Math.max(0, wallTime - this.pausedDurationMs);
  }

  toPlaybackTime(wallTimeMs: number) {
    return Math.max(0, wallTimeMs - this.pausedDurationMs);
  }
}
