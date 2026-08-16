import { highlightCode } from '$lib/docs/highlight.server';

export const prerender = true;

// No distribution packages tinymist, so the script is the ordinary route here rather than a fallback.
const INSTALLER = `curl -LsSf https://github.com/Myriad-Dreamin/tinymist/releases/latest/download/tinymist-installer.sh | sh`;

export async function load() {
	const [installer, brew] = await Promise.all([highlightCode(INSTALLER, 'bash'), highlightCode('brew install tinymist', 'bash')]);
	return { installer, brew };
}
