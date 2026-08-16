import { highlightCode } from '$lib/docs/highlight.server';

export const prerender = true;

const DEB = `wget https://dl.texpile.com/latest/deb -O texpile.deb
sudo apt install ./texpile.deb`;

const APPIMAGE = `wget https://dl.texpile.com/latest/linux -O Texpile.AppImage
chmod +x Texpile.AppImage
./Texpile.AppImage`;

const FUSE = `sudo apt install libfuse2t64   # Ubuntu 24.04 and newer
sudo apt install libfuse2      # Debian 12, Ubuntu 23.10 and older`;

export async function load() {
	const [deb, appimage, fuse] = await Promise.all([
		highlightCode(DEB, 'bash'),
		highlightCode(APPIMAGE, 'bash'),
		highlightCode(FUSE, 'bash')
	]);
	return { deb, appimage, fuse };
}
