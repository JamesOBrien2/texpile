import { highlightCode } from '$lib/docs/highlight.server';

export const prerender = true;

const DEB = `wget https://dl.texpile.com/latest/deb -O texpile.deb
sudo apt install ./texpile.deb`;

const APPIMAGE = `wget https://dl.texpile.com/latest/linux -O Texpile.AppImage
chmod +x Texpile.AppImage
./Texpile.AppImage`;

const FUSE = `sudo apt install libfuse2t64   # Ubuntu 24.04 and newer
sudo apt install libfuse2      # Debian 12, Ubuntu 23.10 and older`;

const INSTALL_TL = `cd /tmp
curl -L -o install-tl-unx.tar.gz https://mirror.ctan.org/systems/texlive/tlnet/install-tl-unx.tar.gz
zcat < install-tl-unx.tar.gz | tar xf -
cd install-tl-2*
perl ./install-tl --no-interaction`;

export async function load() {
	const [deb, appimage, fuse, apt, aptSmall, installTl, smallScheme, path] = await Promise.all([
		highlightCode(DEB, 'bash'),
		highlightCode(APPIMAGE, 'bash'),
		highlightCode(FUSE, 'bash'),
		highlightCode('sudo apt install texlive-full', 'bash'),
		highlightCode('sudo apt install texlive-latex-recommended texlive-latex-extra latexmk', 'bash'),
		highlightCode(INSTALL_TL, 'bash'),
		highlightCode('perl ./install-tl --no-interaction --scheme=small --no-doc-install --no-src-install', 'bash'),
		highlightCode('export PATH=/usr/local/texlive/2026/bin/x86_64-linux:$PATH', 'bash')
	]);
	return { deb, appimage, fuse, apt, aptSmall, installTl, smallScheme, path };
}
