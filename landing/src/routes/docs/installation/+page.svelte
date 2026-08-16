<script lang="ts">
	import { ArrowRight, Sigma, Type } from '@lucide/svelte';
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import SubSection from '$lib/docs/SubSection.svelte';
	import Note from '$lib/docs/Note.svelte';

	let { data }: { data: { deb: string; appimage: string; fuse: string } } = $props();

	const compilers = [
		{
			icon: Sigma,
			name: 'LaTeX',
			href: '/docs/installation/latex',
			blurb: 'A TeX distribution: TeX Live, MacTeX, or MiKTeX.'
		},
		{ icon: Type, name: 'Typst', href: '/docs/installation/typst', blurb: 'One program, tinymist.' }
	];
</script>

<DocsHead
	title={'Installation'}
	description={'Install Texpile on Windows, macOS, or Linux, then a TeX distribution for LaTeX or tinymist for Typst, so Texpile can compile your PDFs.'}
	path="/docs/installation"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'Installation'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'Texpile first, then a compiler for whichever format you write in. Editing works as soon as Texpile opens; producing a PDF needs the second install.'}
	</p>
</header>

<div class="mt-10 space-y-10">
	<Section title={'1. Install Texpile'}>
		<div class="space-y-8">
			<SubSection title={'Windows'} body={'Download the installer and run it. Texpile appears in the Start menu when it finishes.'} />

			<SubSection title={'macOS'} body={'Open the .dmg and drag Texpile to your Applications folder.'} />

			<SubSection
				title={'Linux'}
				body={'On Debian, Ubuntu, and their derivatives, install the .deb with apt rather than dpkg and it resolves the dependencies for you. The leading `./` matters: without it apt looks for a package by that name in your repositories instead of reading the local file.'}
			>
				{@html data.deb}

				<p class="text-surface-600 mt-6 leading-relaxed">
					{'Everywhere else, the AppImage runs on most distributions without installing anything. Make it executable and run it:'}
				</p>
				{@html data.appimage}

				<p class="text-surface-600 mt-6 leading-relaxed">
					{'AppImages need FUSE 2, which recent distributions no longer install by default. If it exits complaining about libfuse.so.2 or dlopen, add it:'}
				</p>
				{@html data.fuse}
			</SubSection>
		</div>

		<div class="mt-8">
			<a href="/download" class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors">
				{'All downloads'}
				<ArrowRight class="h-4 w-4" />
			</a>
		</div>
	</Section>

	<Section title={'2. Install a compiler'} body={'Pick the one for the format you write in. If you write both, install both.'}>
		<div class="grid gap-4 sm:grid-cols-2">
			{#each compilers as c (c.name)}
				<a href={c.href} class="border-surface-200 hover:border-primary-400 group flex flex-col rounded-lg border p-5 transition-colors">
					<span class="bg-primary-500/10 text-primary-600 mb-3 flex h-9 w-9 items-center justify-center rounded-md">
						<c.icon class="h-4.5 w-4.5" />
					</span>
					<span class="text-surface-900 group-hover:text-primary-600 font-semibold">{c.name}</span>
					<span class="text-surface-600 mt-1.5 text-sm leading-relaxed">{c.blurb}</span>
				</a>
			{/each}
		</div>
		<div class="mt-6">
			<Note body={'Markdown needs neither. It has no compile step, so it works with nothing installed beyond Texpile itself.'} />
		</div>
	</Section>

	<Section
		title={'Do I need a compiler?'}
		body={'For editing, no. The visual editor, source editor, spell check, intellisense, and version control all work on their own. For compiling a PDF and for live preview, yes: Texpile runs the compiler on your machine and does not bundle one.'}
	/>

	<Section
		title={'Check it worked'}
		body={'Texpile checks for you. Preferences › Toolchain lists every external program it runs, for both formats, and whether each one was found.'}
	>
		<Note
			body={'Texpile reads the environment when it launches, so restart it after installing anything before deciding a program is missing. The per-format pages above have the command-line test as well.'}
		/>
		<div class="mt-6 flex flex-wrap gap-x-6 gap-y-2">
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
