<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import Note from '$lib/docs/Note.svelte';
</script>

<DocsHead
	title={'Installing LaTeX on macOS'}
	description={'Install MacTeX or BasicTeX on macOS so Texpile can compile LaTeX documents.'}
	path="/docs/installation/latex/macos"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'LaTeX on macOS'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'MacTeX is TeX Live with a native Mac installer, so there is no shell work here.'}
	</p>
</header>

<div class="mt-10 space-y-10">
	<Section
		title={'Install MacTeX'}
		body={'Runs on Intel and Apple silicon, and needs macOS 11 Big Sur or newer. When it finishes, everything is configured. BasicTeX is the same distribution cut down to about 140 MB, with packages added later using `tlmgr`.'}
	>
		<div class="flex flex-wrap gap-x-6 gap-y-2">
			<a
				href="https://www.tug.org/mactex/mactex-download.html"
				target="_blank"
				rel="noopener noreferrer"
				class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
			>
				{'MacTeX download'}
				<ArrowRight class="h-4 w-4" />
			</a>
			<a
				href="https://www.tug.org/mactex/"
				target="_blank"
				rel="noopener noreferrer"
				class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
			>
				{'About MacTeX'}
				<ArrowRight class="h-4 w-4" />
			</a>
		</div>
		<div class="mt-4">
			<Note body={'MacTeX installs TeX Live Utility in /Applications/TeX. Use it to keep the distribution updated.'} />
		</div>
	</Section>

	<Section
		title={'If latexmk comes back "not found"'}
		body={'Open a new Terminal window, and quit and reopen Texpile, before deciding something is wrong.'}
	>
		<Note body={'If it is still missing, re-run the MacTeX installer, or open TeX Live Utility and use its repair option.'} />
		<div class="mt-4">
			<a
				href="/docs/installation/latex"
				class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
			>
				{'Checking the install'}
				<ArrowRight class="h-4 w-4" />
			</a>
		</div>
	</Section>
</div>
