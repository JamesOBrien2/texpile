<script lang="ts">
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import { Library, Bot } from '@lucide/svelte';

	const items = [
		{
			icon: Library,
			name: 'Zotero',
			href: '/docs/integrations/zotero',
			blurb: 'Pick citations from your Zotero library and drop them into your bibliography.'
		},
		{
			icon: Bot,
			name: 'AI assistants (MCP)',
			href: '/docs/integrations/mcp',
			blurb: 'Let Claude Code or Codex read your editor state and drive the app, locally.'
		}
	];
</script>

<DocsHead
	title={'Integrations'}
	description={'Programs Texpile can talk to on your machine, and what each one needs installed.'}
	path="/docs/integrations"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'Integrations'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'Other programs Texpile can talk to on your machine. Both are optional, and each has its own switch in Preferences.'}
	</p>
</header>

<div class="mt-8 grid gap-4 sm:grid-cols-2">
	{#each items as i (i.name)}
		<a href={i.href} class="border-surface-200 hover:border-primary-400 group flex flex-col rounded-lg border p-5 transition-colors">
			<span class="bg-primary-500/10 text-primary-600 mb-3 flex h-9 w-9 items-center justify-center rounded-md">
				<i.icon class="h-4.5 w-4.5" />
			</span>
			<span class="text-surface-900 group-hover:text-primary-600 font-semibold">{i.name}</span>
			<span class="text-surface-600 mt-1.5 text-sm leading-relaxed">{i.blurb}</span>
		</a>
	{/each}
</div>
