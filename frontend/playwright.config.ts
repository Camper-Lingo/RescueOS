import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 45_000,
  expect: { timeout: 10_000 }, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 1080 },
    channel: 'chrome', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: '..\\.venv\\Scripts\\python.exe -B -m uvicorn rescueos.tower.api:app --app-dir .. --host 127.0.0.1 --port 8000', url: 'http://127.0.0.1:8000/api/v1/health', reuseExistingServer: !process.env.CI },
    { command: 'npm.cmd run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  ],
});
