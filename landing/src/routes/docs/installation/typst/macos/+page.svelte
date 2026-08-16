<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import Note from '$lib/docs/Note.svelte';

	let { data }: { data: { brew: string; installer: string } } = $props();
</script>

<DocsHead
	title={'Installing Typst on macOS'}
	description={'Install tinymist on macOS with Homebrew or the standalone installer, so Texpile can compile Typst documents.'}
	path="/docs/installation/typst/macos"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'Typst on macOS'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'One command either way.'}
	</p>
</header>

<div class="mt-10 space-y-10">
	<Section title={'With Homebrew'} body={'Works on Apple silicon and recent Intel macOS:'}>
		{@html data.brew}
	</Section>

	<Section
		title={'Without Homebrew'}
		body={'The project publishes a standalone installer with each release. It puts tinymist in `~/.local/bin` and adds that directory to your PATH in your shell’s init file:'}
	>
		{@html data.installer}
		<div class="mt-6 space-y-4">
			<Note
				body={'This downloads a script from the tinymist project’s releases and runs it immediately. Texpile does not control that script or that release. Open the URL in a browser and read it first if you would rather check what it does.'}
			/>
			<Note
				body={'A Terminal that was already open will not see the new PATH until you open a new window. Texpile reads the environment when it launches, so quit and reopen Texpile too.'}
			/>
		</div>
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
