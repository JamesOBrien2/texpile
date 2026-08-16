<script lang="ts">
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import SubSection from '$lib/docs/SubSection.svelte';
	import Note from '$lib/docs/Note.svelte';
	import Where from '$lib/docs/Where.svelte';

	// values quote the app's own English labels; "Comment" is the action, "Comments" the dock tab
	const where = [
		{ label: 'Add one', value: 'Select text › right-click › Comment', note: 'Also on the selection toolbar, in both editors.' },
		{ label: 'Panel', value: 'Comments', note: 'A tab in the panel below the editor.' }
	];
</script>

<DocsHead
	title={'Comments'}
	description={'Review comments in Texpile: select text and leave a comment, reply and resolve, in the visual editor or in source, on LaTeX, Typst, and Markdown.'}
	path="/docs/comments"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'Comments'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'Select anything and leave a comment. Threads attach to the words rather than to a line number, so they follow the text as the document changes. Reply, resolve, and filter to the file you are in from the Comments panel.'}
	</p>
</header>

<div class="mt-6 space-y-4">
	<Where rows={where} />
</div>

<div class="mt-10 space-y-10">
	<Section
		title={'Where they are stored'}
		body={'In the project, not in your browser or in a cloud account, so they travel with the folder. Share it or commit it and the comments go with it.'}
	>
		<Note
			body={'Nothing is written into the document itself. Your .tex, .typ, or .md file is left exactly as it was, so a comment never turns up in the PDF and never appears if the file is opened in another editor. Comments are only visible in Texpile.'}
		/>
	</Section>

	<Section
		title={'Edit those files in Texpile'}
		body={'Texpile only sees the edits made in Texpile. Change a file in another editor and comments on the changed text can come back detached. If you are using comments on a project, it is strongly recommended you do the editing in Texpile.'}
	/>

	<Section
		title={'When a comment cannot be shown in place'}
		body={'Sometimes a comment has no highlight to sit on. It is never lost: the thread shows a badge in the Comments panel instead.'}
	>
		<div class="space-y-8">
			<SubSection
				title={'Not in this view'}
				body={'The comment is on something the visual editor does not show, such as the preamble. Switch that file to source mode and it appears in place.'}
			/>

			<SubSection
				title={'Detached'}
				body={'The text the comment was on has changed too much to find. The thread is kept, with its replies, but it cannot be re-attached, so read it and resolve it.'}
			/>

			<SubSection
				title={'File deleted'}
				body={'The file the comment lives in is no longer in the project. The thread is kept, and restoring the file brings the comment back in place.'}
			/>
		</div>
	</Section>

	<Section title={'In a shared session'} body={'Comments work in a shared session, and guests can read and write them.'} />
</div>
