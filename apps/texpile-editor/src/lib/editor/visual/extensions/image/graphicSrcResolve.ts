// \includegraphics lets the extension be omitted and the engine pick the file; an extensionless
// src joined straight into a URL 404'd and showed not-found for a figure that exists. Probes the
// extensions the engines try, PDF included; pdflatex prefers .pdf, so it probes first.
export const GRAPHIC_PROBE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif'];

export type ResolvedGraphic = {
	url: string;
	isPdf: boolean;
};

export async function resolveGraphicUrl(
	src: string,
	urlFor: (rel: string) => string,
	exists: (url: string) => Promise<boolean>
): Promise<ResolvedGraphic> {
	if (/\.[a-z0-9]+$/i.test(src)) return { url: urlFor(src), isPdf: /\.pdf$/i.test(src) };
	for (const ext of GRAPHIC_PROBE_EXTENSIONS) {
		const url = urlFor(src + ext);
		if (await exists(url)) return { url, isPdf: ext === '.pdf' };
	}
	// nothing found: hand back the bare join and let the <img> error path show not-found
	return { url: urlFor(src), isPdf: false };
}
