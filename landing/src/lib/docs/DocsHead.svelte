<script lang="ts">
	// The docs are English only, written as plain strings rather than through Paraglide: the
	// screenshots are English-locked anyway, so translating the prose around them buys nothing.
	// The localized routes still exist so the nav can never 404, but they serve this same prose.
	// Hence a canonical pointing at the English URL and NO hreflang alternates, unlike the other
	// pages, which carry them because they are genuinely translated.
	let { title, description, path }: { title: string; description: string; path: string } = $props();

	const url = $derived(`https://texpile.com${path}`);
	const fullTitle = $derived(`${title} - Texpile docs`);
</script>

<svelte:head>
	<title>{fullTitle}</title>
	<meta name="description" content={description} />

	<meta property="og:url" content={url} />
	<meta property="og:title" content={fullTitle} />
	<meta property="og:description" content={description} />

	<meta property="twitter:url" content={url} />
	<meta property="twitter:title" content={fullTitle} />
	<meta property="twitter:description" content={description} />

	<link rel="canonical" href={url} />
</svelte:head>
