// GUI launches on macOS/Linux inherit a stripped PATH (no TeX/Homebrew dirs), hiding synctex and
// git. Recover the real PATH from a login shell, reading $PATH between markers so rc noise can't corrupt it.
import { execFileSync } from 'node:child_process';

export function fixShellPath(): void {
	if (process.platform === 'win32') return;
	const marker = '__TEXPILE_PATH__';
	try {
		const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
		const out = execFileSync(shell, ['-ilc', `printf '${marker}%s${marker}' "$PATH"`], { encoding: 'utf8', timeout: 5000 });
		const m = out.match(new RegExp(`${marker}(.*)${marker}`));
		if (m && m[1]) process.env.PATH = m[1];
	} catch {
		/* fall back to appending the known dirs below */
	}
	// macOS has fixed TeX/Homebrew dirs worth guaranteeing; Linux TeX Live paths are
	// version-stamped, so the probe is all we have there
	if (process.platform === 'darwin') {
		const dirs = (process.env.PATH || '').split(':').filter(Boolean);
		for (const d of ['/Library/TeX/texbin', '/usr/local/bin', '/opt/homebrew/bin', '/opt/local/bin']) {
			if (!dirs.includes(d)) dirs.push(d);
		}
		process.env.PATH = dirs.join(':');
	}
}
