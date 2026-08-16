<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import Note from '$lib/docs/Note.svelte';
	import OsLogo from '$lib/comp/OsLogo.svelte';

	let { data }: { data: { verify: string } } = $props();

	const platforms = [
		{
			os: 'windows' as const,
			name: 'Windows',
			href: '/docs/installation/typst/windows',
			blurb: 'winget, or the standalone installer.'
		},
		{ os: 'apple' as const, name: 'macOS', href: '/docs/installation/typst/macos', blurb: 'Homebrew, or the standalone installer.' },
		{ os: 'linux' as const, name: 'Linux', href: '/docs/installation/typst/linux', blurb: 'The installer script, or Homebrew.' }
	];
</script>

<DocsHead
	title={'Installing Typst'}
	description={'Install tinymist so Texpile can compile Typst: winget on Windows, Homebrew on macOS, and the installer script on Linux.'}
	path="/docs/installation/typst"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'Typst'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'Typst needs one program, tinymist. It compiles the document and provides completion, hover, and the errors shown as you type. You do not need to install typst as well.'}
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
		body={'tinymist is not ours. It is published by the tinymist project, and every command on these pages installs from that project’s own releases or from a third-party package repository, none of which Texpile controls. Check that a command and where it points look right to you before running it.'}
	/>
</div>

<div class="mt-12 space-y-10">
	<Section title={'Check it worked'} body={'This prints tinymist’s own version and the Typst version it compiles with:'}>
		{@html data.verify}
		<div class="mt-6">
			<Note
				body={'Every route puts tinymist on your PATH, and Texpile reads the environment when it launches. So a terminal or a copy of Texpile that was already open will not see it until you close and reopen it. Preferences › Toolchain lists every program Texpile runs and whether it was found.'}
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
