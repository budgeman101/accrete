import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // sim.ts is deliberately DOM-free, so its tests need no browser
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Playwright specs live in tests/e2e and are run by `npm run e2e`
    exclude: ['tests/e2e/**', 'node_modules/**'],
    /* These are SIMULATIONS, not unit tests: several run thousands of ticks over
       a thousand-odd cells because the claims they check are about equilibria
       and turnover, which do not exist at tick 50. The 5s default fails them all
       for taking the time the question needs. */
    testTimeout: 60_000,
  },
});
