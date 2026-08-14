// Enter in the PDF search box means two different things - "search this" and "next match" - and the
// only thing separating them is whether the box still holds the query the matches came from.
import { describe, it, expect } from 'vitest';
import { searchIntent } from '$lib/pdf-view/pdf-viewer/searchIntent';

describe('searchIntent', () => {
	// the reported bug, as its reproduction steps
	it('searches again after the query is edited, instead of walking the old matches', () => {
		// 1-2. "keyword A", Enter: nothing has been searched yet
		expect(searchIntent('keyword A', '', 0, false)).toBe('search');
		// 3. the box now says something else, and the 7 matches on screen are still A's
		expect(searchIntent('keyword B', 'keyword A', 7, false)).toBe('search');
		// 4. once B has been searched, Enter steps through B's matches
		expect(searchIntent('keyword B', 'keyword B', 3, false)).toBe('next');
	});

	it('steps through matches while the query is unchanged', () => {
		expect(searchIntent('fig', 'fig', 12, false)).toBe('next');
		expect(searchIntent('fig', 'fig', 12, true)).toBe('previous');
	});

	// stepping backwards through the previous query's hits is the same lie as stepping forwards
	it('does not let Shift step through a stale result set either', () => {
		expect(searchIntent('keyword B', 'keyword A', 7, true)).toBe('search');
	});

	it('re-searches a query that found nothing, rather than stepping nowhere', () => {
		expect(searchIntent('absent', 'absent', 0, false)).toBe('search');
	});

	// a cleared search leaves query '' and an empty box; Enter must not try to step
	it('treats a cleared box as a search', () => {
		expect(searchIntent('', '', 0, false)).toBe('search');
	});

	// whitespace is part of the query the engine ran, so a trailing space IS a different search
	it('does not smooth over whitespace the search itself would honour', () => {
		expect(searchIntent('fig ', 'fig', 12, false)).toBe('search');
	});
});
