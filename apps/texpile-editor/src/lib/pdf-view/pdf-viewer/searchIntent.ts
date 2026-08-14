// What Enter means in the PDF search box.
//
// Enter is overloaded: it starts a search, and once there are results it steps through them. The
// two only stay distinguishable while the box still holds the query those results came from. It
// used to branch on the match count alone, so editing "keyword A" to "keyword B" and pressing Enter
// kept walking A's matches while the box read B - the search icon beside it, which always searches,
// was the only way out.

export type SearchIntent = 'search' | 'next' | 'previous';

/**
 * @param input   what the box says now
 * @param query   the query the current matches came from ('' once cleared)
 * @param total   number of matches for that query
 * @param shift   Shift was held (step backwards)
 */
export function searchIntent(input: string, query: string, total: number, shift: boolean): SearchIntent {
	// the box no longer describes these matches, so there is nothing to step through: search again.
	// This wins over Shift too - stepping backwards through the previous query's hits is the same lie.
	if (input !== query) return 'search';
	if (shift) return 'previous';
	return total > 0 ? 'next' : 'search';
}
