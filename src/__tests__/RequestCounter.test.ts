import RequestCounter from '../utils/RequestCounter';

describe('RequestCounter', () => {
  let requestCounter: RequestCounter;

  beforeEach(() => {
    // Reset the singleton instance for each test
    (RequestCounter as any).instance = undefined;
    requestCounter = RequestCounter.getInstance();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = RequestCounter.getInstance();
      const instance2 = RequestCounter.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Request Counting', () => {
    it('should start with zero counts', () => {
      const stats = requestCounter.getStats();
      expect(stats.total).toBe(0);
      expect(stats.successful).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.startTime).toBeInstanceOf(Date);
    });

    it('should increment total requests', () => {
      requestCounter.incrementTotal();
      requestCounter.incrementTotal();
      
      const stats = requestCounter.getStats();
      expect(stats.total).toBe(2);
      expect(stats.successful).toBe(0);
      expect(stats.failed).toBe(0);
    });

    it('should increment successful requests', () => {
      requestCounter.incrementSuccessful();
      requestCounter.incrementSuccessful();
      
      const stats = requestCounter.getStats();
      expect(stats.total).toBe(0);
      expect(stats.successful).toBe(2);
      expect(stats.failed).toBe(0);
    });

    it('should increment failed requests', () => {
      requestCounter.incrementFailed();
      requestCounter.incrementFailed();
      
      const stats = requestCounter.getStats();
      expect(stats.total).toBe(0);
      expect(stats.successful).toBe(0);
      expect(stats.failed).toBe(2);
    });

    it('should track all types of requests correctly', () => {
      requestCounter.incrementTotal();
      requestCounter.incrementTotal();
      requestCounter.incrementTotal();
      requestCounter.incrementSuccessful();
      requestCounter.incrementSuccessful();
      requestCounter.incrementFailed();
      
      const stats = requestCounter.getStats();
      expect(stats.total).toBe(3);
      expect(stats.successful).toBe(2);
      expect(stats.failed).toBe(1);
    });
  });

  describe('Stats Management', () => {
    it('should return a copy of stats (not reference)', () => {
      requestCounter.incrementTotal();
      const stats1 = requestCounter.getStats();
      const stats2 = requestCounter.getStats();
      
      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });

    it('should reset stats correctly', async () => {
      requestCounter.incrementTotal();
      requestCounter.incrementSuccessful();
      requestCounter.incrementFailed();
      
      const statsBeforeReset = requestCounter.getStats();
      expect(statsBeforeReset.total).toBe(1);
      expect(statsBeforeReset.successful).toBe(1);
      expect(statsBeforeReset.failed).toBe(1);
      
      // Add a small delay to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 1));
      
      requestCounter.reset();
      
      const statsAfterReset = requestCounter.getStats();
      expect(statsAfterReset.total).toBe(0);
      expect(statsAfterReset.successful).toBe(0);
      expect(statsAfterReset.failed).toBe(0);
      expect(statsAfterReset.startTime.getTime()).toBeGreaterThanOrEqual(statsBeforeReset.startTime.getTime());
    });

    it('should log stats without throwing errors', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      requestCounter.incrementTotal();
      requestCounter.incrementSuccessful();
      requestCounter.logStats();
      
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });
});