<script lang="ts">
	import { ChevronDown, ChevronLeft, ChevronRight, BookOpen } from '@lucide/svelte';
	import { page } from '$app/state';
	import { TOPICS, hrefFor, siblings, lookup, type Topic } from '$lib/docs/nav';

	let { children } = $props();

	// route.id, not url.pathname: the localized routes (/de/docs/visual-editing/math) reroute to the
	// same route id, so this stays correct in every locale. Already the full path segment (e.g.
	// "visual-editing/math") for a nested topic, since that's exactly what the route id contains.
	const slug = $derived(page.route.id?.replace('/docs/', '') ?? '');
	const isIndex = $derived(page.route.id === '/docs');
	const pager = $derived(siblings(slug));
	const active = $derived(lookup(slug));
	const currentTitle = $derived(active?.topic.title ?? 'Documentation');
</script>

<div class="container mx-auto max-w-6xl flex-1 px-4 py-8 sm:px-6 md:py-12 lg:px-8">
	<div class="lg:grid lg:grid-cols-[16rem_1fr] lg:gap-12">
		<!-- mobile: the same nav, folded into a disclosure so it costs one row instead of a screen -->
		<details class="border-surface-200 mb-8 rounded-lg border lg:hidden">
			<summary class="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 font-medium">
				<span class="flex items-center gap-2">
					<BookOpen class="text-surface-400 h-4 w-4" />
					{currentTitle}
				</span>
				<ChevronDown class="text-surface-400 h-4 w-4 shrink-0" />
			</summary>
			<nav class="border-surface-200 border-t px-2 py-2">
				{@render navList()}
			</nav>
		</details>

		<aside class="hidden lg:block">
			<!-- the tree is tall enough with a branch expanded to pass a short laptop viewport, and a
			     sticky element that overflows is simply cut off, so it scrolls within itself -->
			<nav class="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
				<a
					href="/docs"
					class="mb-3 flex items-center gap-2 px-3 text-xs font-semibold tracking-wide uppercase {isIndex
						? 'text-primary-600'
						: 'text-surface-500 hover:text-surface-900'}"
				>
					<BookOpen class="h-3.5 w-3.5" />
					{'Documentation'}
				</a>
				{@render navList()}
			</nav>
		</aside>

		<div class="min-w-0">
			{@render children()}

			{#if !isIndex}
				<nav class="border-surface-200 mt-14 grid gap-3 border-t pt-6 sm:grid-cols-2">
					{#if pager.prev}
						<a
							href={hrefFor(pager.prev.slug)}
							class="border-surface-200 hover:border-primary-400 group rounded-lg border p-4 transition-colors"
						>
							<span class="text-surface-500 flex items-center gap-1 text-xs">
								<ChevronLeft class="h-3.5 w-3.5" />
								{'Previous'}
							</span>
							<span class="text-surface-900 group-hover:text-primary-600 mt-1 block font-medium">{pager.prev.title}</span>
						</a>
					{:else}
						<div class="hidden sm:block"></div>
					{/if}
					{#if pager.next}
						<a
							href={hrefFor(pager.next.slug)}
							class="border-surface-200 hover:border-primary-400 group rounded-lg border p-4 text-right transition-colors"
						>
							<span class="text-surface-500 flex items-center justify-end gap-1 text-xs">
								{'Next'}
								<ChevronRight class="h-3.5 w-3.5" />
							</span>
							<span class="text-surface-900 group-hover:text-primary-600 mt-1 block font-medium">{pager.next.title}</span>
						</a>
					{/if}
				</nav>
			{/if}
		</div>
	</div>
</div>

<!--
	Recursive, so the depth of the tree lives in TOPICS and not here. The install pages are three
	levels deep (installation > latex > windows); everything else is one or two.

	Grandchildren render only under the branch the reader is inside. Showing all of them at once put
	25 rows in a sidebar that has to stay under one screen, and a reader installing Typst has no use
	for the three LaTeX platform pages.
-->
{#snippet navItems(topics: Topic[], prefix: string, depth: number)}
	<ul class={depth === 0 ? 'space-y-0.5' : 'border-surface-200 mt-0.5 mb-1 ml-3 space-y-0.5 border-l pl-3'}>
		{#each topics as topic (topic.slug)}
			{@const path = prefix ? `${prefix}/${topic.slug}` : topic.slug}
			{@const onPath = slug === path || slug.startsWith(`${path}/`)}
			<li>
				<a
					href={hrefFor(path)}
					class="rounded-base block px-3 text-sm transition-colors {depth === 0 ? 'py-1.5' : 'py-1'} {path === slug
						? 'bg-primary-50 text-primary-700 font-medium'
						: `${depth === 0 ? 'text-surface-600' : 'text-surface-500'} hover:bg-surface-100 hover:text-surface-900`}"
				>
					{topic.title}
				</a>
				{#if topic.children && (depth === 0 || onPath)}
					{@render navItems(topic.children, path, depth + 1)}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet navList()}
	{@render navItems(TOPICS, '', 0)}
{/snippet}
