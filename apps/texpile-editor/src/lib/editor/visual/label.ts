type LabelType = 'figure' | 'equation' | 'table' | 'ref' | 'citation';

/** short unique label, format texpile-{type}-{12 hex chars}. */
export function generateLabel(type: LabelType): string {
	const segments = crypto.randomUUID().split('-');
	const shortId = segments[0] + segments[1].slice(0, 4);

	const prefix = type === 'figure' ? 'fig' : type === 'equation' ? 'eq' : type === 'citation' ? 'cite' : type;
	return `texpile-${prefix}-${shortId}`;
}

export function isTexpileLabel(label: string | null | undefined): boolean {
	return !!label && label.startsWith('texpile-');
}

/** 12 hex chars for keeping duplicated labels unique. */
export function generateCopySuffix(): string {
	const segments = crypto.randomUUID().split('-');
	return segments[0] + segments[1].slice(0, 4);
}

export function sanitizeLabel(label: string): string {
	return label.trim().replace(/[^a-zA-Z0-9-_:]/g, '');
}

/** another node of `typeName` already carries this label somewhere else in the document */
export function isLabelInUse(
	view: {
		state: {
			doc: { descendants(cb: (n: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => boolean | void): void };
		};
	},
	typeName: string,
	label: string,
	ownPos: number
): boolean {
	let inUse = false;
	view.state.doc.descendants((n, nodePos) => {
		if (nodePos !== ownPos && n.type.name === typeName && n.attrs.label === label) {
			inUse = true;
			return false;
		}
	});
	return inUse;
}
