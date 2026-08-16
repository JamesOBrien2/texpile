<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import Note from '$lib/docs/Note.svelte';
</script>

<DocsHead
	title={'Installing LaTeX on Windows'}
	description={'Install TeX Live or MiKTeX on Windows so Texpile can compile LaTeX documents.'}
	path="/docs/installation/latex/windows"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'LaTeX on Windows'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'The installer is graphical and configures itself, so there is nothing to add to your PATH by hand on this platform.'}
	</p>
</header>

<div class="mt-10 space-y-10">
	<Section
		title={'Install TeX Live'}
		body={'Download `install-tl-windows.exe` from CTAN and run it. An Advanced button has the scheme and directory options if you want a smaller install or a different location. It adds TeX Live to your search path when it finishes.'}
	>
		<div class="flex flex-wrap gap-x-6 gap-y-2">
			<a
				href="https://mirror.ctan.org/systems/texlive/tlnet/install-tl-windows.exe"
				class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
			>
				{'install-tl-windows.exe'}
				<ArrowRight class="h-4 w-4" />
			</a>
			<a
				href="https://www.tug.org/texlive/windows.html"
				target="_blank"
				rel="noopener noreferrer"
				class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
			>
				{'TeX Live on Windows'}
				<ArrowRight class="h-4 w-4" />
			</a>
		</div>
		<div class="mt-4 space-y-4">
			<Note
				body={'A full install is 7 GB or more and can take a long time. The Advanced screen lets you pick a smaller scheme, and TeX Live Manager adds packages later as documents need them.'}
			/>
			<Note body={'MiKTeX works just as well, but only one of the two can be active at a time: they share the same search path.'} />
		</div>
	</Section>

	<Section
		title={'Check it worked'}
		body={'The installer edits the search path, so a Command Prompt that was already open will not see TeX until you close and reopen it. Texpile reads the environment when it launches, so restart Texpile too.'}
	>
		<a
			href="/docs/installation/latex"
			class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
		>
			{'Checking the install'}
			<ArrowRight class="h-4 w-4" />
		</a>
	</Section>
</div>
