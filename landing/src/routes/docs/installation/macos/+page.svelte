<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import Note from '$lib/docs/Note.svelte';
</script>

<DocsHead
	title={'Installation on macOS'}
	description={'Install Texpile on macOS, then install MacTeX or BasicTeX so Texpile can compile your PDFs.'}
	path="/docs/installation/macos"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'macOS'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'MacTeX is TeX Live with a native Mac installer, so this platform needs no shell work either, with one caveat about the search path at the bottom.'}
	</p>
</header>

<div class="mt-10 space-y-10">
	<Section title={'1. Install Texpile'} body={'Open the .dmg and drag Texpile to your Applications folder.'}>
		<a href="/download" class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors">
			{'Download Texpile'}
			<ArrowRight class="h-4 w-4" />
		</a>
	</Section>

	<Section
		title={'2. Install MacTeX'}
		body={'MacTeX is TeX Live packaged as a native Mac installer, notarized by Apple, native on both Intel and Apple silicon, and requiring macOS 11 Big Sur or newer. When it finishes, everything is configured and ready. BasicTeX is the same distribution cut down to about 140 MB: it typesets standard LaTeX documents and you add packages later with `tlmgr`.'}
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
		title={'3. If latexmk comes back "not found"'}
		body={'MacTeX symlinks its binaries into /Library/TeX/texbin and puts that on your PATH, but the step can fail to complete, or need a fresh Terminal window before it takes effect. So latexmk can be missing in a Terminal you opened before installing, even though the install succeeded.'}
	>
		<div class="space-y-4">
			<Note
				body={'Open a new Terminal window first. Texpile reads the environment when it launches, so quit and reopen Texpile as well before deciding something is wrong.'}
			/>
			<Note body={'If it is still missing, re-run the MacTeX installer, or open TeX Live Utility and use its repair option.'} />
		</div>
		<div class="mt-4">
			<a
				href="/docs/installation"
				class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
			>
				{'Checking the install'}
				<ArrowRight class="h-4 w-4" />
			</a>
		</div>
	</Section>
</div>
