<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import Note from '$lib/docs/Note.svelte';
	import OsLogo from '$lib/comp/OsLogo.svelte';

	let { data }: { data: { verify: string } } = $props();

	const platforms = [
		{ os: 'windows' as const, name: 'Windows', href: '/docs/installation/latex/windows', blurb: 'TeX Live from CTAN, or MiKTeX.' },
		{ os: 'apple' as const, name: 'macOS', href: '/docs/installation/latex/macos', blurb: 'MacTeX, or BasicTeX for a smaller install.' },
		{ os: 'linux' as const, name: 'Linux', href: '/docs/installation/latex/linux', blurb: 'TeX Live from apt, or from upstream.' }
	];
</script>

<DocsHead
	title={'Installing LaTeX'}
	description={'Install a TeX distribution so Texpile can compile LaTeX: TeX Live or MiKTeX on Windows, MacTeX or BasicTeX on macOS, and TeX Live on Linux.'}
	path="/docs/installation/latex"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'LaTeX'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'LaTeX needs a TeX distribution, packaged under a different name on each platform.'}
	</p>
</header>

<div class="mt-8 grid gap-4 sm:grid-cols-3">
	{#each platforms as p (p.name)}
		<a href={p.href} class="border-surface-200 hover:border-primary-400 group flex flex-col rounded-lg border p-5 transition-colors">
			<span class="bg-primary-500/10 text-primary-600 mb-3 flex h-9 w-9 items-center justify-center rounded-md">
				<OsLogo os={p.os} class="h-4.5 w-4.5" />
			</span>
			<span class="text-surface-900 group-hover:text-primary-600 font-semibold">{p.name}</span>
			<span class="text-surface-600 mt-1.5 text-sm leading-relaxed">{p.blurb}</span>
		</a>
	{/each}
</div>

<div class="mt-6">
	<Note
		body={'TeX Live, MacTeX, and MiKTeX are not ours. Every download and package source on these pages belongs to those projects or to your distribution, and Texpile controls none of them. Check that a command and where it points look right to you before running it.'}
	/>
</div>

<div class="mt-12 space-y-10">
	<Section
		title={'Check it worked'}
		body={'In a terminal, ask latexmk for its version. If that prints a version, Texpile will find it too:'}
	>
		{@html data.verify}
		<p class="text-surface-600 mt-6 leading-relaxed">
			{'Then open a folder in Texpile and press Compile. The default command is latexmk with lualatex, and anything that goes wrong appears in the Problems panel.'}
		</p>
		<div class="mt-6">
			<Note
				body={'Texpile reads the environment when it launches, so restart it after installing before deciding a program is missing. Preferences › Toolchain lists every program Texpile runs and whether it was found.'}
			/>
		</div>
		<div class="mt-6 flex flex-wrap gap-x-6 gap-y-2">
			<a
				href="/docs/installation"
				class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
			>
				{'Back to installation'}
				<ArrowRight class="h-4 w-4" />
			</a>
			<a
				href="/docs/compiling"
				class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
			>
				{'Compiling, in full'}
				<ArrowRight class="h-4 w-4" />
			</a>
		</div>
	</Section>
</div>
