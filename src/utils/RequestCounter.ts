import log from './log';

export interface RequestStats {
  total: number;
  successful: number;
  failed: number;
  startTime: Date;
}

export default class RequestCounter {
  private stats: RequestStats;
  private static instance: RequestCounter;

  private constructor() {
    this.stats = {
      total: 0,
      successful: 0,
      failed: 0,
      startTime: new Date()
    };
  }

  public static getInstance(): RequestCounter {
    if (!RequestCounter.instance) {
      RequestCounter.instance = new RequestCounter();
    }
    return RequestCounter.instance;
  }

  public incrementTotal(): void {
    this.stats.total++;
  }

  public incrementSuccessful(): void {
    this.stats.successful++;
  }

  public incrementFailed(): void {
    this.stats.failed++;
  }

  public getStats(): RequestStats {
    return { ...this.stats };
  }

  public logStats(): void {
    const uptime = Math.round((Date.now() - this.stats.startTime.getTime()) / 1000);
    log(
      `[RequestCounter] Stats - Total: ${this.stats.total}, Successful: ${this.stats.successful}, Failed: ${this.stats.failed}, Uptime: ${uptime}s`,
      'info'
    );
  }

  public reset(): void {
    this.stats = {
      total: 0,
      successful: 0,
      failed: 0,
      startTime: new Date()
    };
    log('[RequestCounter] Stats reset', 'info');
  }
}