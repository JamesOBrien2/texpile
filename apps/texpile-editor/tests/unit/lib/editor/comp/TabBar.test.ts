// @vitest-environment jsdom
// The tab strip's overflow math: tabs shrink until one more would be narrower than the readable
// floor, and the rest move into a dropdown. None of that is visible to a node-environment test,
// and getting it wrong means either a strip that runs off-screen or tabs hidden while space is
// left over. clientWidth is stubbed because jsdom lays nothing out (every box is 0x0).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import TabBar from '../../../../../src/lib/editor/comp/TabBar.svelte';

const files = (n: number) => Array.from({ length: n }, (_, i) => `/ws/file${i}.tex`);

let host: HTMLDivElement;
let app: Record<string, unknown> | null = null;
let width = 1280;

beforeEach(() => {
	host = document.createElement('div');
	document.body.appendChild(host);
	// bind:clientWidth observes the box; jsdom has neither ResizeObserver nor layout
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor(private cb: ResizeObserverCallback) {}
			observe(el: Element) {
				this.cb([{ target: el } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
			}
			unobserve() {}
			disconnect() {}
		}
	);
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
});

afterEach(() => {
	if (app) unmount(app);
	app = null;
	host.remove();
	vi.unstubAllGlobals();
});

type BarProps = ComponentProps<typeof TabBar>;
function render(props: Pick<BarProps, 'tabs' | 'activePath'> & Partial<BarProps>) {
	app = mount(TabBar, {
		target: host,
		props: { dirty: false, onActivate: () => {}, onClose: () => {}, onKeep: () => {}, ...props }
	}) as Record<string, unknown>;
	flushSync();
}

const visibleTabs = () => [...host.querySelectorAll('[role="tab"]')].map((el) => el.getAttribute('title'));

describe('TabBar overflow', () => {
	it('shows every tab while they all fit', () => {
		width = 1280;
		render({ tabs: files(6), activePath: '/ws/file0.tex' });
		expect(visibleTabs().length).toBe(6);
	});

	it('hides the ones past capacity and reports how many', () => {
		width = 400; // floor((400 - 44) / 116) = 3
		render({ tabs: files(8), activePath: '/ws/file0.tex' });
		expect(visibleTabs()).toEqual(['/ws/file0.tex', '/ws/file1.tex', '/ws/file2.tex']);
		expect(host.textContent).toContain('5'); // 8 open, 3 shown
	});

	it('slides the window so the active tab is always on the strip', () => {
		width = 400;
		render({ tabs: files(8), activePath: '/ws/file7.tex' });
		expect(visibleTabs()).toEqual(['/ws/file5.tex', '/ws/file6.tex', '/ws/file7.tex']);
	});

	it('keeps at least one tab even in a strip too narrow for the floor', () => {
		width = 60;
		render({ tabs: files(4), activePath: '/ws/file0.tex' });
		expect(visibleTabs().length).toBe(1);
	});

	it('italicises the preview tab and nothing else', () => {
		width = 1280;
		render({ tabs: files(3), activePath: '/ws/file0.tex', previewPath: '/ws/file2.tex' });
		const italic = [...host.querySelectorAll('span.italic')].map((el) => el.textContent);
		expect(italic).toEqual(['file2.tex']);
	});
});
