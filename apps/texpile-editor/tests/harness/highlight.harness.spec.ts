// TEMPORARY: does picking a language in the settings popover actually re-highlight the open
// CodeMirror? Run with:
//   pnpm exec playwright test -c tests/harness/playwright.harness.config.ts
import { test, expect } from '@playwright/test';

const REAL_CM = '.cm-editor:not(.cm-static-placeholder)';

// 'def' is a keyword for Python's grammar and plain text for XML's, so the number of styled
// spans on the first line collapses if and only if the highlighter really switched.
const countSpans = `(() => {
	const line = document.querySelector('.cm-editor:not(.cm-static-placeholder) .cm-line');
	return line ? line.querySelectorAll('span').length : -1;
})()`;

test('picking a new language re-highlights the open editor', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});

	await page.goto('/devcm.html');
	await expect(page.locator(REAL_CM)).toHaveCount(1);
	// Python highlighting applied (async import): 'def' is a keyword, so it gets a styled span
	await expect.poll(async () => page.evaluate(countSpans), { timeout: 5000 }).toBeGreaterThan(0);

	await page.locator('.codeblock-settings-container button').click();
	const search = page.getByPlaceholder('Search languages...');
	await expect(search).toBeVisible();
	await search.fill('xml');
	await page.getByRole('button', { name: 'XML', exact: true }).click();

	// the source must record the switch...
	const lang = await page.evaluate(() => {
		let l = '';
		(
			window as never as {
				pmview: { state: { doc: { descendants(cb: (n: { type: { name: string }; attrs: { lang?: string } }) => void): void } } };
			}
		).pmview.state.doc.descendants((n) => {
			if (n.type.name === 'code_block') l = String(n.attrs.lang);
		});
		return l;
	});
	expect(lang).toBe('XML');

	// ...and the colours must follow: 'def' is not an XML keyword, so its styled span vanishes
	await expect.poll(async () => page.evaluate(countSpans), { timeout: 5000 }).toBe(0);

	// a language with NO CodeMirror grammar must also visibly switch (to plain), not silently
	// keep the previous grammar's colours
	await page.locator('.codeblock-settings-container button').click();
	await search.fill('python');
	await page.getByRole('button', { name: 'Python', exact: true }).click();
	await expect.poll(async () => page.evaluate(countSpans), { timeout: 5000 }).toBeGreaterThan(0);
	await page.locator('.codeblock-settings-container button').click();
	await search.fill('ada');
	await page.getByRole('button', { name: 'Ada', exact: true }).click();
	await expect.poll(async () => page.evaluate(countSpans), { timeout: 5000 }).toBe(0);

	expect(errors, errors.join('\n')).toEqual([]);
});
