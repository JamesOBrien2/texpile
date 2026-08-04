<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import DocsHead from '$lib/docs/DocsHead.svelte';
	import Section from '$lib/docs/Section.svelte';
	import SubSection from '$lib/docs/SubSection.svelte';
	import Note from '$lib/docs/Note.svelte';

	let {
		data
	}: {
		data: {
			deb: string;
			appimage: string;
			fuse: string;
			apt: string;
			aptSmall: string;
			installTl: string;
			smallScheme: string;
			path: string;
		};
	} = $props();
</script>

<DocsHead
	title={'Installation on Linux'}
	description={'Install Texpile on Linux from the .deb or the AppImage, then install TeX Live with apt or from upstream so Texpile can compile your PDFs.'}
	path="/docs/installation/linux"
/>

<header>
	<h1 class="text-surface-900 text-3xl font-bold md:text-4xl">{'Linux'}</h1>
	<p class="text-surface-600 mt-4 text-lg leading-relaxed">
		{'On Debian, Ubuntu, and their derivatives both halves are one apt command each. Everywhere else, use the AppImage and your own package manager.'}
	</p>
</header>

<div class="mt-10 space-y-10">
	<Section title={'1. Install Texpile'}>
		<div class="space-y-8">
			<SubSection
				title={'Debian and Ubuntu'}
				body={'Install the .deb with apt rather than dpkg and it resolves the dependencies for you. The leading `./` matters: without it apt looks for a package by that name in your repositories instead of reading the local file.'}
			>
				{@html data.deb}
			</SubSection>

			<SubSection
				title={'Everywhere else'}
				body={'The AppImage runs on most distributions without installing anything. Make it executable and run it:'}
			>
				{@html data.appimage}

				<p class="text-surface-600 mt-6 leading-relaxed">
					{'AppImages need FUSE 2, which recent distributions no longer install by default. If it exits complaining about libfuse.so.2 or dlopen, add it:'}
				</p>
				{@html data.fuse}
			</SubSection>
		</div>

		<div class="mt-8">
			<a href="/download" class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors">
				{'All downloads'}
				<ArrowRight class="h-4 w-4" />
			</a>
		</div>
	</Section>

	<Section title={'2. Install TeX Live'}>
		<div class="space-y-8">
			<SubSection
				title={'With apt'}
				body={'On Debian, Ubuntu, and their derivatives this is much the easier route. One command, nothing to add to your PATH afterwards, and TeX updates arrive with the rest of your system updates:'}
			>
				{@html data.apt}

				<p class="text-surface-600 mt-6 leading-relaxed">
					{'`texlive-full` is around 5 GB because it pulls in every package Debian ships. If you would rather not, this is a much smaller starting point that still builds most papers, and you can add packages later:'}
				</p>
				{@html data.aptSmall}

				<div class="mt-6">
					<Note
						body={'Other distributions package TeX Live too, under their own names: look for a texlive-scheme-full or texlive meta package in dnf, pacman, or zypper.'}
					/>
				</div>
			</SubSection>

			<SubSection
				title={'From upstream'}
				body={'Any packaged build trails the current TeX Live release, often by a year or more. If you need the current release, or a package your distribution does not carry, install upstream instead. This is TeX Live’s own recipe, and it does not need root as long as you can write to the destination:'}
			>
				{@html data.installTl}

				<p class="text-surface-600 mt-6 leading-relaxed">
					{'That installs everything, which is 7 GB or more and can take a long time. For a much smaller install, roughly the equivalent of BasicTeX at 600 MB or so:'}
				</p>
				{@html data.smallScheme}

				<div class="mt-6">
					<Note body={'The default paper size is A4. Run `tlmgr paper letter` afterwards to change it.'} />
				</div>
			</SubSection>

			<SubSection
				title={'Setting your PATH'}
				body={'Only for the upstream install; apt does this for you. The installer prints the exact line to add when it finishes. Put it in your shell’s init file, substituting your release year and platform:'}
			>
				{@html data.path}
				<div class="mt-4">
					<Note
						body={'Skipping this is the usual reason a fresh TeX install appears to be missing. Texpile reads the environment when it launches, so after editing your init file, log out and back in, then restart Texpile, before deciding something went wrong.'}
					/>
				</div>
			</SubSection>
		</div>
	</Section>

	<Section title={'3. Check it worked'}>
		<a
			href="/docs/installation"
			class="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1.5 font-medium transition-colors"
		>
			{'Checking the install'}
			<ArrowRight class="h-4 w-4" />
		</a>
	</Section>
</div>
