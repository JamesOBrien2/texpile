/** Fade-and-lift a block the first time it scrolls into view.
 *
 * The hidden pre-state lives in app.css behind both `.js` and a reduced-motion guard, and the
 * `reveal` class is only ever added here at runtime, so the shipped HTML contains nothing hidden:
 * crawlers and no-JS visitors always get the full page.
 *
 * Deliberately NOT built on IntersectionObserver. IO is throttled or silent in background tabs,
 * some embedded webviews, and non-compositing/headless contexts, and it can deliver one callback
 * and then go quiet. Anything that hides content up front and waits for a callback to un-hide it
 * risks rendering the whole page blank, which is far worse than losing an animation. A single
 * shared scroll listener reading rects is a few lines, costs almost nothing at this scale, and is
 * true whenever the page has actually scrolled.
 */
const pending = new Set<HTMLElement>();
let listening = false;
let frame = 0;

/** Reveal a little before the block is fully on screen, so the motion reads as "arriving". */
const MARGIN = 0.12;

function show(node: HTMLElement) {
	node.classList.add('shown');
	pending.delete(node);
	// clear the stagger so a later re-entry doesn't wait again
	setTimeout(() => node.style.removeProperty('transition-delay'), 800);
}

function sweep() {
	frame = 0;
	const limit = window.innerHeight * (1 - MARGIN);
	for (const node of pending) {
		const r = node.getBoundingClientRect();
		if (r.top < limit && r.bottom > 0) show(node);
	}
	if (pending.size === 0) stop();
}

function schedule() {
	if (frame) return;
	frame = requestAnimationFrame(sweep);
}

function stop() {
	if (!listening) return;
	listening = false;
	window.removeEventListener('scroll', schedule);
	window.removeEventListener('resize', schedule);
}

function start() {
	if (listening) return;
	listening = true;
	window.addEventListener('scroll', schedule, { passive: true });
	window.addEventListener('resize', schedule, { passive: true });
}

export function reveal(node: HTMLElement, delay = 0) {
	node.classList.add('reveal');

	// motion is unwanted: show it now and never register it
	if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
		node.classList.add('shown');
		return;
	}

	if (delay) node.style.transitionDelay = `${delay}ms`;
	pending.add(node);
	start();
	// whatever is already on screen at mount reveals on the next frame, without needing a scroll
	schedule();

	return {
		destroy() {
			pending.delete(node);
			if (pending.size === 0) stop();
		}
	};
}
