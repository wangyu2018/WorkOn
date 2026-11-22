import { defineConfig } from '@playwright/test'

/**
 * WorkOn UI 自测配置
 *
 * 测试不启动浏览器，而是通过 CDP 连接正在运行的 WorkOn：
 *   1. npm run dev:debug   （固定调试端口 9333）
 *   2. npm run test:e2e
 *
 * 每个用例只操作 SCENARIO-E2E- 前缀的测试数据，结束后自动清理。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/e2e',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
})
