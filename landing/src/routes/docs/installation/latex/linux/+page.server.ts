import { highlightCode } from '$lib/docs/highlight.server';

export const prerender = true;

const INSTALL_TL = `cd /tmp
curl -L -o install-tl-unx.tar.gz https://mirror.ctan.org/systems/texlive/tlnet/install-tl-unx.tar.gz
zcat < install-tl-unx.tar.gz | tar xf -
cd install-tl-2*
perl ./install-tl --no-interaction`;

export async function load() {
	const [apt, aptSmall, installTl, smallScheme, path] = await Promise.all([
		highlightCode('sudo apt install texlive-full', 'bash'),
		highlightCode('sudo apt install texlive-latex-recommended texlive-latex-extra latexmk', 'bash'),
		highlightCode(INSTALL_TL, 'bash'),
		highlightCode('perl ./install-tl --no-interaction --scheme=small --no-doc-install --no-src-install', 'bash'),
		highlightCode('export PATH=/usr/local/texlive/2026/bin/x86_64-linux:$PATH', 'bash')
	]);
	return { apt, aptSmall, installTl, smallScheme, path };
}
