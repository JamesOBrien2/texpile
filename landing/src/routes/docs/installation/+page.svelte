<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import OsLogo from '$lib/comp/OsLogo.svelte';

	let { data }: { data: { verify: string } } = $props();

	const platforms = [
		{ os: 'windows' as const, name: 'Windows', href: '/docs/installation/windows', blurb: 'The installer, then TeX Live or MiKTeX.' },
		{ os: 'apple' as const, name: 'macOS', href: '/docs/installation/macos', blurb: 'The .dmg, then MacTeX or BasicTeX.' },
		{ os: 'linux' as const, name: 'Linux', href: '/docs/installation/linux', blurb: 'The .deb or AppImage, then TeX Live.' }
	];
</script>

<DocsHead
	title={'Installation'}
	description={'Install Texpile on Windows, macOS, or Linux, then install a TeX distribution (TeX Live, MacTeX, or MiKTeX) so Texpile can compile your PDFs.'}
	path="/docs/installation"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'Installation'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'Two installs, in this order: Texpile itself, then a TeX distribution for it to compile with. Editing works as soon as Texpile opens; producing a PDF needs the second one.'}
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

<div class="mt-12 space-y-10">
	<Section
		title={'Do I need LaTeX installed?'}
		body={'For editing, no. The visual editor, source editor, spell check, intellisense, and version control all work on their own. For compiling a PDF and for live preview, yes: Texpile does not bundle a TeX distribution and does not compile in the cloud. It runs the one on your machine, which is what keeps your documents local and lets you use the exact packages and versions your paper depends on.'}
	/>

	<Section
		title={'Check it worked'}
		body={'Whichever platform you are on, this is the test. In a terminal, ask latexmk for its version. If that prints a version, Texpile will find it too:'}
	>
		{@html data.verify}
		<p class="text-surface-600 mt-6 leading-relaxed">
			{'Then open a folder in Texpile and press Compile. The default command is latexmk with lualatex, and anything that goes wrong is parsed out of the log into the Problems panel rather than left in the terminal.'}
		</p>
		<div class="mt-4 flex flex-wrap gap-x-6 gap-y-2">
			<a
				href="/docs/getting-started"
				class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
			>
				{'Getting started'}
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
