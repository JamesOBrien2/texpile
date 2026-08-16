<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import Note from '$lib/docs/Note.svelte';

	let {
		data
	}: {
		data: { apt: string; aptSmall: string; installTl: string; smallScheme: string; path: string };
	} = $props();
</script>

<DocsHead
	title={'Installing LaTeX on Linux'}
	description={'Install TeX Live on Linux with apt or from upstream so Texpile can compile LaTeX documents.'}
	path="/docs/installation/latex/linux"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'LaTeX on Linux'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'On Debian, Ubuntu, and their derivatives this is one apt command. Everywhere else, use your own package manager or install upstream.'}
	</p>
</header>

<div class="mt-10 space-y-10">
	<Section
		title={'With apt'}
		body={'One command, nothing to add to your PATH afterwards, and TeX updates arrive with your system updates:'}
	>
		{@html data.apt}

		<p class="text-surface-600 mt-6 leading-relaxed">
			{'`texlive-full` is around 5 GB. This is a much smaller starting point that still builds most papers, and you can add packages later:'}
		</p>
		{@html data.aptSmall}

		<div class="mt-6">
			<Note
				body={'Other distributions package TeX Live too, under their own names: look for a texlive-scheme-full or texlive meta package in dnf, pacman, or zypper.'}
			/>
		</div>
	</Section>

	<Section
		title={'From upstream'}
		body={'A packaged build trails the current TeX Live release, often by a year or more. For the current release, install upstream instead. This does not need root as long as you can write to the destination:'}
	>
		{@html data.installTl}

		<p class="text-surface-600 mt-6 leading-relaxed">
			{'That installs everything, which is 7 GB or more and can take a long time. For a much smaller install, roughly the equivalent of BasicTeX at 600 MB or so:'}
		</p>
		{@html data.smallScheme}

		<div class="mt-6 space-y-4">
			<Note
				body={'This downloads an installer from a CTAN mirror and runs it. Texpile does not control CTAN or its mirrors. TeX Live publishes checksums and signatures for the installer if you want to verify it before running it.'}
			/>
			<Note body={'The default paper size is A4. Run `tlmgr paper letter` afterwards to change it.'} />
		</div>
	</Section>

	<Section
		title={'Setting your PATH'}
		body={'Only for the upstream install; apt does this for you. The installer prints the exact line to add when it finishes. Put it in your shell’s init file, substituting your release year and platform:'}
	>
		{@html data.path}
		<div class="mt-4">
			<Note
				body={'Skipping this is the usual reason a fresh TeX install appears to be missing. Texpile reads the environment when it launches, so after editing your init file, log out and back in, then restart Texpile, before deciding something went wrong.'}
			/>
		</div>
		<div class="mt-6">
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
