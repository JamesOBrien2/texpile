import { highlightCode } from '$lib/docs/highlight.server';

export const prerender = true;

const INSTALLER = `curl -LsSf https://github.com/Myriad-Dreamin/tinymist/releases/latest/download/tinymist-installer.sh | sh`;

export async function load() {
	const [brew, installer] = await Promise.all([highlightCode('brew install tinymist', 'bash'), highlightCode(INSTALLER, 'bash')]);
	return { brew, installer };
}
