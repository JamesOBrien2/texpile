// The PDF toolbar's overflow behavior: collapse control groups (in a fixed order) while the row
// overflows, restore them as width returns, and run the "..." menu that holds the collapsed ones.
// A runes class so the toolbar just binds its elements and reads `hidden`/`menuOpen`.
export class CollapsingToolbar {
	row = $state<HTMLDivElement>();
	menuButton = $state<HTMLButtonElement>();
	menuEl = $state<HTMLDivElement>();
	menuOpen = $state(false);
	menuPos = $state({ top: 0, right: 0 });
	private collapsed = $state(0);

	get hidden(): Set<string> {
		return new Set(this.order.slice(0, this.collapsed));
	}

	// row width when each step was taken; restoring only above it keeps the loop from oscillating
	private widthAt: number[] = [];
	private frame = 0;

	constructor(private readonly order: readonly string[]) {
		this.attachEffects();
	}

	get anyCollapsed(): boolean {
		return this.collapsed > 0;
	}

	toggleMenu = () => {
		if (!this.menuOpen && this.menuButton) {
			const r = this.menuButton.getBoundingClientRect();
			// measured against the window the toolbar is IN - the popped-out preview's, not
			// necessarily this module's global
			const vw = this.menuButton.ownerDocument.defaultView?.innerWidth ?? window.innerWidth;
			this.menuPos = { top: r.bottom + 4, right: Math.max(4, vw - r.right) };
		}
		this.menuOpen = !this.menuOpen;
	};

	private schedule = () => {
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.fit();
		});
	};

	private fit() {
		const el = this.row;
		if (!el) return;
		const over = el.scrollWidth > el.clientWidth + 1;
		if (over && this.collapsed < this.order.length) {
			this.widthAt[this.collapsed + 1] = el.clientWidth;
			this.collapsed++;
			this.schedule();
			return;
		}
		if (!over && this.collapsed > 0 && el.clientWidth > (this.widthAt[this.collapsed] ?? 0) + 8) {
			this.collapsed--;
			this.schedule();
		}
	}

	private attachEffects(): void {
		// Dismiss on any pointer down outside, and on Escape. Deliberately NOT a scrim element: a
		// scrim only intercepts clicks if it paints above everything, and inside a component it
		// competes in whatever stacking context it lands in - the PDF canvas painted over it and
		// ate the click.
		$effect(() => {
			if (!this.menuOpen) return;
			const onDown = (e: PointerEvent) => {
				const t = e.target as Node | null;
				if (t && (this.menuEl?.contains(t) || this.menuButton?.contains(t))) return;
				// A control in the menu may open a popover that PORTALS to document.body - the math
				// symbol grids do. That content is outside menuEl by construction, so treating it as
				// "outside" tore the menu down mid-click: the symbol never inserted and the mathfield
				// lost focus.
				if (t instanceof Element && t.closest('[data-scope]')) return;
				this.menuOpen = false;
			};
			const onKey = (e: KeyboardEvent) => {
				if (e.key === 'Escape') this.menuOpen = false;
			};
			// on the toolbar's own window, so dismissal works when the viewer is popped out
			const win = this.menuButton?.ownerDocument.defaultView ?? window;
			win.addEventListener('pointerdown', onDown, true);
			win.addEventListener('keydown', onKey, true);
			return () => {
				win.removeEventListener('pointerdown', onDown, true);
				win.removeEventListener('keydown', onKey, true);
			};
		});

		$effect(() => {
			const el = this.row;
			if (!el) return;
			const ro = new ResizeObserver(this.schedule);
			ro.observe(el);
			this.schedule();
			return () => {
				ro.disconnect();
				if (this.frame) cancelAnimationFrame(this.frame);
				this.frame = 0;
			};
		});
	}
}
