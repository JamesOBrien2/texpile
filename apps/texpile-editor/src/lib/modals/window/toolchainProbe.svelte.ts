// The toolchain probe's results, held at module scope so revisiting the Preferences tab shows
// what was already found instead of re-spawning every probe process.
class ToolchainProbe {
	tinymist = $state<TinymistInfo | null | 'unchecked'>('unchecked');
	probes = $state<ToolProbe[]>([]);
	probing = $state(false);
	/** the probe itself could not run - an old main process, or no desktop bridge at all */
	probeFailed = $state(false);

	async run(): Promise<void> {
		this.probing = true;
		this.probeFailed = false;
		try {
			const bridge = window.texpileTypst;
			if (!bridge?.probeToolchain) throw new Error('no toolchain bridge');
			// in parallel: latexindent alone can take a second, and tinymist resolves separately
			// because it reports more (embedded Typst version, and which location won)
			const [tools, tm] = await Promise.all([bridge.probeToolchain(), bridge.resolve()]);
			this.probes = tools;
			this.tinymist = tm;
		} catch {
			// A FAILED probe is not the same as "nothing is installed", and reporting it as such is
			// how a stale main process made a full TeX Live install look absent. Say we don't know.
			this.probeFailed = true;
			this.probes = [];
			this.tinymist = null;
		} finally {
			this.probing = false;
		}
	}

	probeFor(id: string): ToolProbe | undefined {
		return this.probes.find((p) => p.id === id);
	}
}

export const toolchainProbe = new ToolchainProbe();
