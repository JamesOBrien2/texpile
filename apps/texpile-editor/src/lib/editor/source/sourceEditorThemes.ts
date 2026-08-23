import { EditorView } from '@codemirror/view';

// flat markers; CM's stock ones are gradient blobs. colours baked in, data: URIs can't reach CSS vars
function lintMarker(svg: string) {
	return `url('data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${svg}</svg>`)}')`;
}

export const gutterTheme = EditorView.theme({
	// gutters aren't content: without this, double-clicking a line number or a fold arrow selects it
	'.cm-gutters': { userSelect: 'none', WebkitUserSelect: 'none' },
	// tight padding: this cell sits BETWEEN the lint and fold rails, which carry their own.
	// three digits of floor so the text stops shifting every power of ten
	'.cm-lineNumbers .cm-gutterElement': {
		padding: '0 2px 0 3px',
		minWidth: 'calc(3ch + 2px + 3px)',
		textAlign: 'center'
	},
	'.cm-gutter-lint': { width: '1em' },
	// pinned: a gutter is as wide as its widest marker, so the text would slide sideways the
	// moment the first parse produced fold ranges
	'.cm-foldGutter': { width: '14px' },
	// flex-centre: stock CM leaves the marker inline, sitting above the line-number baseline
	'.cm-gutter-lint .cm-gutterElement': { padding: '0 1px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
	'.cm-lint-marker': { width: '0.7em', height: '0.7em' },
	'.cm-lint-marker-error': { content: lintMarker('<circle cx="20" cy="20" r="15" fill="#ef4444"/>') },
	'.cm-lint-marker-warning': { content: lintMarker('<circle cx="20" cy="20" r="15" fill="#f59e0b"/>') },
	'.cm-lint-marker-info': { content: lintMarker('<circle cx="20" cy="20" r="15" fill="#3b82f6"/>') }
});

// y-codemirror.next's stock theme shifts text: its line selections and caret trade padding for
// margins that do not cancel out. pin both so a peer's cursor can never move a glyph on this screen
export const yRemoteLayoutFix = EditorView.theme({
	'.cm-yLineSelection': { margin: '0', padding: '0 2px 0 6px' },
	'.cm-ySelectionCaret': { border: 'none', margin: '0' },
	'.cm-ySelectionCaret::before': {
		content: "''",
		position: 'absolute',
		top: '0',
		bottom: '0',
		left: '-1px',
		width: '2px',
		backgroundColor: 'inherit'
	}
});
