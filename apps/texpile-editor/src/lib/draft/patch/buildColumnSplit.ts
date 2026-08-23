/* eslint-disable @typescript-eslint/no-explicit-any */
// SPLIT patch geometry: the paragraph straddles a column break. Fill column A from the
// paragraph's top to its capacity, spill the remaining lines to column B's top, shift B's
// content below by the spill-height change. Always provisional.
import { glyphRows } from '../geometry/glyphRows';
import type { Cal } from '../locate/locate.types';
import type { Patch } from './patch.types';

type SplitDeps = {
	h1: number;
	dk: number;
	colBottom: number;
	contentFloorOf: (p: number) => number;
	pageRecords: (n: number) => any[];
};

export function buildColumnSplit(
	cal: Cal & { spill: NonNullable<Cal['spill']> },
	records: any[],
	lineRecs: any[],
	d: SplitDeps
): { segA: Patch; segB: Patch; spillPage: number; kA: number } {
	const capA = Math.max(1, Math.floor((d.colBottom - (cal.b1 - d.h1)) / cal.medGap));
	const kA = Math.min(lineRecs.length, capA);
	const cutY = kA >= lineRecs.length ? Infinity : ((lineRecs[kA - 1] as any).y + (lineRecs[kA] as any).y) / 2;
	const recsA = records.filter((x: any) => x.t === 'font' || (x.y ?? 0) < cutY);
	const recsB = records.filter((x: any) => x.t === 'font' || (x.y ?? 0) >= cutY);
	const yFirstB = kA < lineRecs.length ? (lineRecs[kA] as any).y : 0;
	const newSpillH = kA < lineRecs.length ? (lineRecs[lineRecs.length - 1] as any).y - yFirstB : -cal.medGap;
	const segA: Patch = {
		top: cal.b1 - d.h1,
		dropTop: cal.b1 - d.h1 - 2,
		dropBottom: cal.bk + cal.medGap * 0.6,
		delta: 0,
		paraLeft: cal.paraLeft,
		colL: cal.colL,
		colR: cal.colR,
		newRecs: recsA
	};
	const spillOn = cal.spill.pageNo ?? cal.pageNo;
	const spillDelta = newSpillH - (cal.spill.bk - cal.spill.b1);
	const segB: Patch = {
		top: cal.spill.b1 - yFirstB,
		dropTop: cal.spill.b1 - d.h1 - 2,
		dropBottom: cal.spill.bk + d.dk + 2,
		delta: spillDelta,
		paraLeft: cal.spill.paraLeft,
		colL: cal.spill.colL,
		colR: cal.spill.colR,
		newRecs: kA < lineRecs.length ? recsB : [],
		flowBottom: d.contentFloorOf(spillOn),
		flowPred: glyphRows(
			d
				.pageRecords(spillOn)
				.filter(
					(x) =>
						x.t === 'g' && x.x >= cal.spill.colL && x.x <= cal.spill.colR && x.y > cal.spill.bk + 0.5 && x.y <= d.contentFloorOf(spillOn)
				),
			cal.medGap
		)
			.slice(0, 10)
			.map((rw) => ({ y: rw.y + spillDelta, cs: rw.cs }))
	};
	return { segA, segB, spillPage: spillOn, kA };
}
