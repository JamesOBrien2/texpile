// TEMPORARY: points the harness spec at the already-running vite dev server.
import type { PlaywrightTestConfig } from '@playwright/test';

const config: PlaywrightTestConfig = {
	testDir: '.',
	testMatch: /\.harness\.spec\.ts$/,
	timeout: 30000,
	use: { baseURL: 'http://localhost:5173' }
};

export default config;
