import { box } from '$lib/runes/box.svelte';

// counter bumped to make every ref display recalculate
export const refUpdateTrigger = box(0);

export function triggerRefUpdate() {
	refUpdateTrigger.current += 1;
}
