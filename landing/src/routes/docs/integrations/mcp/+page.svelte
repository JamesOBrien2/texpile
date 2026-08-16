<script lang="ts">
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import Figure from '$lib/docs/Figure.svelte';
	import Bullets from '$lib/docs/Bullets.svelte';
	import Note from '$lib/docs/Note.svelte';
	import Where from '$lib/docs/Where.svelte';
	import mcpModalShot from '$lib/assets/showcase/app/mcp-modal.png';

	const where = [
		{
			label: 'Setting',
			value: 'Preferences › MCP server',
			note: 'Preferences opens from the start screen, and from File › Preferences… once a folder is open.'
		}
	];

	// one line per tool the MCP server registers (electron/src/mcp/server.ts)
	const tools = [
		'Read the editor state: the open file, the current view, and the selection.',
		'Read content you have typed but not saved yet.',
		'Read the current compile errors and warnings.',
		'Open a file in the editor.',
		'Show a diff of a file.',
		'Switch between the visual, source, and diff views.',
		'Show a given source line in the PDF.',
		'Run a compile.'
	];
</script>

<DocsHead
	title={'AI assistants (MCP)'}
	description={'Texpile exposes a local MCP server so Claude Code, Codex, and other assistants can read your editor state and compile errors and drive the editor.'}
	path="/docs/integrations/mcp"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'AI assistants (MCP)'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'Texpile exposes a local MCP server, so an AI assistant can see what you are working on and drive the editor. It stays off until you turn it on in Preferences.'}
	</p>
</header>

<div class="mt-6"><Where rows={where} /></div>

<Figure
	src={mcpModalShot}
	alt={'The Connect an assistant dialog, with setup commands for Claude Code and Codex'}
	caption={'The Connect an assistant dialog, with setup commands for Claude Code and Codex'}
	narrow
/>

<div class="mt-10 space-y-10">
	<Section
		title={'Setting it up'}
		body={"Preferences shows the server's address along with a ready-made command for Claude Code and a config entry for Codex. They are not interchangeable, so copy the one for your client. Preferences fills in the real port for you."}
	>
		<div class="space-y-4">
			<div>
				<p class="text-surface-700 mb-2 text-sm font-medium">{'Claude Code'}</p>
				<pre class="border-surface-200 bg-surface-50 text-surface-800 overflow-x-auto rounded-lg border p-4 font-mono text-sm"><code
						>claude mcp add --transport http texpile http://127.0.0.1:PORT</code
					></pre>
			</div>
			<div>
				<p class="text-surface-700 mb-2 text-sm font-medium">{'Codex, in its config file'}</p>
				<pre class="border-surface-200 bg-surface-50 text-surface-800 overflow-x-auto rounded-lg border p-4 font-mono text-sm"><code
						>[mcp_servers.texpile]{'\n'}url = "http://127.0.0.1:PORT"</code
					></pre>
			</div>
		</div>
	</Section>

	<Section title={'What an assistant can do'} body={'A small set of actions, not general access to your disk.'}>
		<Bullets items={tools} />
		<div class="mt-4">
			<Note
				body={'None of these edit your files. To make changes, an assistant should use its own terminal or file-editing tools on the .tex files on disk, the same as it would if Texpile were not open.'}
			/>
		</div>
	</Section>

	<Section title={'In a shared session'} body={'Host only.'} />

	<Section title={'Local only'} body={'The server is reachable only from your own machine, and Texpile sends nothing anywhere.'}>
		<Note
			body={'What your assistant does with what it reads is between you and your assistant. If it is a cloud model, your document content reaches that provider the same way it would if you pasted it in.'}
		/>
	</Section>
</div>
