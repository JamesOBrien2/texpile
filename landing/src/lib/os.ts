export type OS = 'windows' | 'mac' | 'linux';

/** null when the visitor isn't on one of the three desktop targets (mobile, bots, JS-less SSR). */
export function detectOS(): OS | null {
	if (typeof navigator === 'undefined') return null;
	const ua = navigator.userAgent;
	if (/Windows|Win32|Win64/i.test(ua)) return 'windows';
	if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) return 'mac';
	if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return 'linux';
	return null;
}
