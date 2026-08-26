// The timeline is only as good as these two parsers: one reads the version list, the other reads
// what differs between a version and the working copy. Both are fed streams that real repos
// produce and naive splitting mangles - a subject that is not the last field, a rename that prints
// two paths on one line.
import { describe, it, expect } from 'vitest';
import { parseGitLog, parseNameStatus } from '../../../../../../electron/src/gitService';

// NUL between records and US between fields, because neither can appear in a subject or a name
const REC = '\x00';
const FIELD = '\x1f';

/** builds the stream `git log --format=...%s` produces */
function stream(commits: { hash: string; short: string; author: string; date: string; subject: string; parents?: string }[]): string {
	return commits
		.map((c) => `${REC}${c.hash}${FIELD}${c.short}${FIELD}${c.author}${FIELD}${c.date}${FIELD}${c.parents ?? 'p1'}${FIELD}${c.subject}\n`)
		.join('');
}

const one = {
	hash: 'a'.repeat(40),
	short: 'aaaaaaa',
	author: 'Ada Lovelace',
	date: '2026-08-25T10:00:00+01:00',
	subject: 'Rewrote the results section'
};

describe('parseGitLog', () => {
	it('reads a version', () => {
		const [e] = parseGitLog(stream([one]));
		expect(e).toEqual({ ...one, parentCount: 1 });
	});

	// the timeline draws one straight lane, which is only the truth while every version has one
	// parent. A merge is where that lane is a simplification, so it has to be visible.
	it('counts the versions a merge was made from', () => {
		const [e] = parseGitLog(stream([{ ...one, parents: 'aaa111 bbb222' }]));
		expect(e.parentCount).toBe(2);
	});

	it('calls a root commit parentless rather than counting an empty field as one', () => {
		const [e] = parseGitLog(stream([{ ...one, parents: '' }]));
		expect(e.parentCount).toBe(0);
	});

	it('keeps versions in the order git emitted them', () => {
		const second = { ...one, hash: 'b'.repeat(40), short: 'bbbbbbb', subject: 'Added the ablation table' };
		expect(parseGitLog(stream([one, second])).map((e) => e.subject)).toEqual([one.subject, second.subject]);
	});

	// the subject is last precisely so this is lossless, but a subject that ever carried a US must
	// come back whole rather than truncated at it
	it('keeps a subject containing the field separator intact', () => {
		const [e] = parseGitLog(stream([{ ...one, subject: `Fig${FIELD}5 redrawn` }]));
		expect(e.subject).toBe(`Fig${FIELD}5 redrawn`);
	});

	it('survives an empty log and trailing blank lines', () => {
		expect(parseGitLog('')).toEqual([]);
		expect(parseGitLog('\n\n')).toEqual([]);
		expect(parseGitLog(stream([one]) + '\n\n')).toHaveLength(1);
	});

	it('skips a record with no hash instead of emitting a blank row', () => {
		expect(parseGitLog(`${REC}${FIELD}${FIELD}${FIELD}${FIELD}orphan\n`)).toEqual([]);
	});
});

describe('parseNameStatus', () => {
	it('reads a letter and a path per line', () => {
		expect(parseNameStatus('M\tpaper/main.tex\nA\tpaper/refs.bib\nD\tpaper/old.tex\n')).toEqual([
			{ path: 'paper/main.tex', status: 'M' },
			{ path: 'paper/refs.bib', status: 'A' },
			{ path: 'paper/old.tex', status: 'D' }
		]);
	});

	// a rename prints old then new; opening the old path would open nothing
	it('takes the destination of a rename, not its source', () => {
		expect(parseNameStatus('R096\tpaper/intro.tex\tpaper/introduction.tex\n')).toEqual([{ path: 'paper/introduction.tex', status: 'R' }]);
	});

	// a copy did not exist before, so it reads as an add; a typechange is a modification
	it('folds git’s rarer letters onto the four the panel can colour', () => {
		expect(parseNameStatus('C100\ta.tex\tb.tex\nT\tlink.tex\n')).toEqual([
			{ path: 'b.tex', status: 'A' },
			{ path: 'link.tex', status: 'M' }
		]);
	});

	it('ignores blank and tabless lines rather than inventing files from them', () => {
		expect(parseNameStatus('\nnot a file line\n\nM\treal.tex\n')).toEqual([{ path: 'real.tex', status: 'M' }]);
	});

	it('survives empty output', () => {
		expect(parseNameStatus('')).toEqual([]);
	});
});
