import { describe, expect, it } from 'vitest';
import { flowShiftSteps, flowDyAt } from '$lib/draft/patch/glueShift';

// vpack's distribution is linear per order (glue_set = x / total_stretch): with the page's
// real glue records the below-band shift must decay to zero at the column bottom.
const vg = (y: number, st: number, sto = 0, sh = 0, sho = 0) => ({ t: 'vg', x: 100, y, st, sto, sh, sho });

describe('flowShiftSteps', () => {
	it('a shrink distributes over stretch and pins the bottom line', () => {
		const steps = flowShiftSteps([vg(200, 2), vg(300, 2)], 150, 400, 90, 400, -12);
		expect(steps).not.toBeNull();
		// above the first glue: full shift; between: half absorbed; past the last: pinned
		expect(flowDyAt(steps, 180, -12)).toBe(-12);
		expect(flowDyAt(steps, 250, -12)).toBe(-6);
		expect(flowDyAt(steps, 380, -12)).toBe(0);
	});

	it('growth consumes shrink capacity, not stretch', () => {
		expect(flowShiftSteps([vg(200, 5)], 150, 400, 90, 400, 8)).toBeNull();
		const steps = flowShiftSteps([vg(200, 0, 0, 4)], 150, 400, 90, 400, 8);
		expect(flowDyAt(steps, 300, 8)).toBe(0);
	});

	it('an infinite-order glue swallows everything below the finite ones', () => {
		const steps = flowShiftSteps([vg(200, 3, 0), vg(300, 1, 1)], 150, 400, 90, 400, -10)!;
		expect(steps).toHaveLength(1);
		expect(flowDyAt(steps, 250, -10)).toBe(-10); // finite glue absorbed nothing
		expect(flowDyAt(steps, 350, -10)).toBe(0);
	});

	it('glue outside the column or the flow window never participates', () => {
		expect(flowShiftSteps([vg(200, 2), { ...vg(250, 2), x: 999 }], 220, 400, 90, 400, -6)).toBeNull();
	});
});
