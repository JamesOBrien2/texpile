import { highlightCode } from '$lib/docs/highlight.server';

export const prerender = true;

// The exact winget id, not `winget install tinymist`: the same publisher also ships
// Myriad-Dreamin.TinymistViewer and Myriad-Dreamin.TinymistDocsTool, which are different programs
// and compile nothing. Do not shorten it.
const INSTALLER = `powershell -c "irm https://github.com/Myriad-Dreamin/tinymist/releases/latest/download/tinymist-installer.ps1 | iex"`;

export async function load() {
	const [winget, installer] = await Promise.all([
		highlightCode('winget install Myriad-Dreamin.Tinymist', 'powershell'),
		highlightCode(INSTALLER, 'powershell')
	]);
	return { winget, installer };
}
