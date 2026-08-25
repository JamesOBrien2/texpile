/* eslint-disable @typescript-eslint/naming-convention -- TeX geometry shorthand: col L/R edges on page B */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { columnCandidates } from './columnCandidates';
import { COL_GUTTER } from './tolerances';
import { glyphRows } from '../geometry/glyphRows';
import type { PageRecord } from '../geometry/geometry.types';
import type { Cal } from '../locate/locate.types';
import type { Patch } from '../patch/patch.types';

export type OverflowContext = {
	pageRecords(n: number): PageRecord[];
	contentFloor(page: number): number;
	pageCount(): number;
	colSep?: number;
};

export type OverflowGeometry = {
	h1: number;
	dk: number;
	delta: number;
	colBottom: number;
	belowBases: number[];
	lastBelow: number;
	// the daemon's \vsplit answer (recsA = what fit, recsB = the remainder): the ENGINE's
	// break row, penalties included. Absent (older daemon, split refused): the line
	// arithmetic below stands in.
	engine?: { recsA: PageRecord[]; recsB: PageRecord[] };
};

export type OverflowPlan = {
	segA: Patch;
	segsB: Patch[];
	samePage: boolean;
	spillPage: number;
	kA: number;
	lineCount: number;
	movedCount: number;
};

// The truthful overflow split: the edit's column keeps the band replace + shift with
// everything past the column bottom CLIPPED; those rows re-draw at the top of the next
// slot in READING ORDER -- the next column of this page when the edit's column is not
// the last one, else the next page's first column -- as insert segments (para tail at
// the slot's text left, moved page rows offset by the measured column displacement),
// pushing the slot's content down. First-order break estimate -> caller always marks
// provisional and reconciles.
export function planOverflowSplit(
	ctx: OverflowContext,
	cal: Cal,
	recs: PageRecord[],
	lineRecs: PageRecord[],
	g: OverflowGeometry
): OverflowPlan | null {
	const { h1, dk, delta, colBottom } = g;
	const topA = cal.b1 - h1;
	let kA: number;
	let recsA: PageRecord[];
	let tailRecs: PageRecord[];
	let yFirstTail: number; // first tail line's baseline in its own box coords
	let tailSpan = 0; // first tail line top -> last tail baseline + depth
	const bLines = g.engine ? (g.engine.recsB.filter((x: any) => x.t === 'line') as any[]) : [];
	if (g.engine && bLines.length) {
		kA = g.engine.recsA.filter((x: any) => x.t === 'line').length;
		recsA = g.engine.recsA;
		tailRecs = g.engine.recsB;
		yFirstTail = bLines[0].y;
		tailSpan = bLines[bLines.length - 1].y + (bLines[bLines.length - 1].d ?? 2) - (yFirstTail - (bLines[0].h ?? h1));
	} else {
		// para lines whose patched position crosses the column bottom
		kA = lineRecs.length;
		while (kA > 1 && topA + lineRecs[kA - 1].y + (lineRecs[kA - 1].d ?? 2) > colBottom + 1) kA--;
		const cutY = kA < lineRecs.length ? (lineRecs[kA - 1].y + lineRecs[kA].y) / 2 : Infinity;
		recsA = recs.filter((x) => x.t === 'font' || (x.y ?? 0) < cutY);
		tailRecs = kA < lineRecs.length ? recs.filter((x) => x.t === 'font' || (x.y ?? 0) >= cutY) : [];
		yFirstTail = kA < lineRecs.length ? lineRecs[kA].y : 0;
		if (tailRecs.length) tailSpan = lineRecs[lineRecs.length - 1].y + dk - (yFirstTail - h1);
	}
	// existing content-flow rows the shift pushes past the bottom (belowBases already
	// excludes the bottom-anchored footer via the content floor)
	const floorA = ctx.contentFloor(cal.pageNo);
	const movedFrom = g.belowBases.filter((y) => y + delta + dk > colBottom + 1);
	const movedMinY = movedFrom.length ? Math.min(...movedFrom) : Infinity;
	const pageA = ctx.pageRecords(cal.pageNo);
	const movedRecs = movedFrom.length
		? pageA.filter(
				(x: any) =>
					x.t === 'font' ||
					((x.t === 'g' || x.t === 'rule' || x.t === 'image' || x.t === 'lit') &&
						x.x >= cal.colL &&
						x.x <= cal.colR &&
						(x.y ?? 0) >= movedMinY - 0.5 &&
						(x.y ?? 0) <= floorA)
			)
		: [];
	if (!tailRecs.length && !movedRecs.length) return null;
	// the next slot in reading order: TeX fills columns left to right before breaking the
	// page, so a non-final column overflows into the NEXT COLUMN of the SAME page. The
	// next column's origin is ARITHMETIC -- this column's text left + the engine's
	// \columnwidth + \columnsep -- never elected from glyph clusters: nested cluster
	// candidates (an indented abstract) are fine for MATCH windows, which lose harmlessly,
	// but as a slot they painted the spill back inside this same column, over the title.
	// Content past the next origin proves a real column there; else route to the next page.
	const myTx = cal.colL + COL_GUTTER;
	const gA = pageA.filter((x: any) => x.t === 'g');
	const nextTx = myTx + cal.W + (ctx.colSep && ctx.colSep > 0 ? ctx.colSep : 10);
	const maxRight = gA.length ? Math.max(...gA.map((x: any) => x.x as number)) : 0;
	const nextCol = maxRight > nextTx + 1 ? nextTx : null;
	const samePage = nextCol !== null;
	const pB = samePage ? cal.pageNo : cal.pageNo + 1;
	if (!samePage && pB > ctx.pageCount()) return null;
	// target slot geometry: body top under any isolated running-header row
	const gB = samePage ? gA : ctx.pageRecords(pB).filter((x: any) => x.t === 'g');
	const colTx = samePage ? nextCol! : gB.length ? (columnCandidates(gB, cal.W, COL_GUTTER, ctx.colSep)[0] ?? myTx) : myTx;
	const colLB = colTx - COL_GUTTER;
	const colRB = colTx + cal.W + COL_GUTTER;
	function rowsIn(lo: number, hi: number) {
		let rows = gB.length
			? glyphRows(
					gB.filter((x: any) => x.x >= lo && x.x <= hi),
					cal.medGap
				)
			: [];
		while (rows.length >= 2 && rows[1].y - rows[0].y > cal.medGap * 2.2) rows = rows.slice(1);
		return rows;
	}
	// the slot's body top: the highest paragraph line the ENGINE broke at this column's
	// width inside the slot window (pl records) -- full-width material (a title block
	// spanning both columns) carries w = \textwidth and drops out, where the glyph-row
	// scan mistook it for the column top. Row scan stays as the older-bridge fallback.
	const recsB = samePage ? pageA : ctx.pageRecords(pB);
	const plB = (recsB as any[]).filter((x) => x.t === 'pl' && Math.abs(x.w - cal.W) <= 2 && x.x >= colLB && x.x <= colRB);
	const rowsB = rowsIn(colLB, colRB);
	// an empty next column still starts at the page's text top: mirror this column's
	const topB = plB.length
		? Math.min(...plB.map((x: any) => x.y as number))
		: rowsB.length
			? rowsB[0].y
			: samePage
				? (rowsIn(cal.colL, cal.colR)[0]?.y ?? h1 + cal.medGap)
				: h1 + cal.medGap;
	// moved rows carry page-absolute x: offset by the measured column displacement, and
	// snap sub-tolerance offsets to 0 so same-column targets keep their exact x
	const movedDx = Math.abs(colTx - myTx) <= COL_GUTTER ? 0 : colTx - myTx;
	const tailH = tailRecs.length ? tailSpan : 0;
	const movedH = movedRecs.length ? Math.max(...movedFrom) + dk - (movedMinY - h1) : 0;
	const push = (tailH ? tailH + cal.medGap : 0) + (movedH ? movedH + cal.medGap : 0);
	const segA: Patch = {
		top: topA,
		dropTop: topA - 2,
		dropBottom: cal.bk + dk + 2,
		delta,
		paraLeft: cal.paraLeft,
		colL: cal.colL,
		colR: cal.colR,
		newRecs: recsA,
		// EXACTLY the negation of the moved-rows predicate (y + delta + dk > colBottom + 1),
		// or the boundary row draws on both pages
		clipBottom: colBottom + 1 - dk,
		flowBottom: floorA
	};
	const segsB: Patch[] = [];
	let curTop = topB;
	if (tailRecs.length) {
		segsB.push({
			top: curTop - yFirstTail,
			dropTop: topB - h1 - 2,
			dropBottom: topB - h1 - 2,
			delta: push,
			paraLeft: colTx,
			colL: colLB,
			colR: colRB,
			newRecs: tailRecs
		});
		curTop += tailH + cal.medGap;
	}
	if (movedRecs.length)
		segsB.push({
			top: curTop + h1 - movedMinY,
			dropTop: topB - h1 - 2,
			dropBottom: topB - h1 - 2,
			delta: segsB.length ? 0 : push,
			paraLeft: movedDx,
			colL: colLB,
			colR: colRB,
			newRecs: movedRecs
		});
	return { segA, segsB, samePage, spillPage: pB, kA, lineCount: lineRecs.length, movedCount: movedFrom.length };
}
