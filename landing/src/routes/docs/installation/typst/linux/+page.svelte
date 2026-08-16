<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import Note from '$lib/docs/Note.svelte';

	let { data }: { data: { installer: string; brew: string } } = $props();
</script>

<DocsHead
	title={'Installing Typst on Linux'}
	description={'Install tinymist on Linux with the installer script or Homebrew, so Texpile can compile Typst documents.'}
	path="/docs/installation/typst/linux"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'Typst on Linux'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'No distribution packages tinymist, so the installer script is the usual route here.'}
	</p>
</header>

<div class="mt-10 space-y-10">
	<Section
		title={'With the installer script'}
		body={'Published with each release. It installs into `~/.local/bin` and adds that directory to your PATH in your shell’s init file:'}
	>
		{@html data.installer}
		<div class="mt-6 space-y-4">
			<Note
				body={'This downloads a script from the tinymist project’s releases and runs it immediately. Texpile does not control that script or that release. Open the URL in a browser and read it first if you would rather check what it does.'}
			/>
			<Note
				body={'The script edits your shell’s init file, so a terminal that was already open will not see tinymist. Texpile reads the environment when it launches, so restart Texpile as well.'}
			/>
		</div>
	</Section>

	<Section title={'With Homebrew'} body={'Homebrew runs on Linux too:'}>
		{@html data.brew}
		<div class="mt-6">
			<a
				href="/docs/installation/typst"
				class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
			>
				{'Checking the install'}
				<ArrowRight class="h-4 w-4" />
			</a>
		</div>
	</Section>
</div>
