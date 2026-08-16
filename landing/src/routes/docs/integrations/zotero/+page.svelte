<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import Note from '$lib/docs/Note.svelte';
	import Where from '$lib/docs/Where.svelte';

	const where = [
		{ label: 'Editor', value: 'Right-click › Insert citation from Zotero', note: 'In a LaTeX or Typst file.' },
		{ label: 'Palette', value: 'Insert citation from Zotero' },
		{ label: 'Settings', value: 'Preferences › Integrations › Zotero citations', note: 'Off hides the action.' }
	];
</script>

<DocsHead
	title={'Zotero'}
	description={'Insert citations from your Zotero library into a LaTeX or Typst document in Texpile. Needs Zotero running with the Better BibTeX plugin.'}
	path="/docs/integrations/zotero"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'Zotero'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'Search your Zotero library from inside Texpile, pick references, and have them added to your bibliography with the citation put in at the caret.'}
	</p>
</header>

<div class="mt-6 space-y-4">
	<Where rows={where} />
</div>

<div class="mt-10 space-y-10">
	<Section
		title={'You need the Better BibTeX plugin'}
		body={'Better BibTeX is a Zotero plugin, and Texpile needs it to search your library. Install it in Zotero first.'}
	>
		<div class="flex flex-wrap gap-x-6 gap-y-2">
			<a
				href="https://retorque.re/zotero-better-bibtex/installation/"
				target="_blank"
				rel="noopener noreferrer"
				class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
			>
				{'Installing Better BibTeX'}
				<ArrowRight class="h-4 w-4" />
			</a>
		</div>
		<div class="mt-4">
			<Note
				body={'Better BibTeX is not ours. It is a third-party Zotero plugin, and Texpile controls neither it nor Zotero. Check that the download looks right to you before installing it.'}
			/>
		</div>
	</Section>

	<Section title={'Zotero has to be running'} body={'Keep Zotero open while you use the action.'} />

	<Section
		title={'Where the references go'}
		body={'Into the bibliography your main file declares. If there is none, Texpile finds or creates a .bib for you. A newly created one is not wired up: add the bibliography command to your main file yourself.'}
	>
		<Note body={'References already in the bibliography are not added twice.'} />
	</Section>

	<Section title={'What it works on'} body={'LaTeX and Typst, in both editors. Not offered in Markdown.'} />

	<Section title={'In a shared session'} body={'Host only.'} />
</div>
