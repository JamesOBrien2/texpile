import {
	HardDriveDownload,
	Type,
	Monitor,
	Apple,
	TerminalSquare,
	Rocket,
	Eye,
	PenLine,
	Code,
	Sparkles,
	Play,
	Files,
	GitBranch,
	Users,
	Bot,
	MessageSquare,
	Plug,
	Library,
	Sigma,
	Image,
	Table,
	BookMarked,
	BoxSelect,
	SpellCheck,
	type Icon
} from '@lucide/svelte';

export interface Topic {
	/** path segment under its parent (or under /docs for a top-level topic) */
	slug: string;
	title: string;
	blurb: string;
	icon: typeof Icon;
	children?: Topic[];
}

// order here is the sidebar order and the prev/next order; keep it in sync with
// `docsEntries` in svelte.config.js, which prerenders the localized variants
export const TOPICS: Topic[] = [
	{
		slug: 'installation',
		title: 'Installation',
		blurb: 'Install Texpile, then a compiler for the format you write in.',
		icon: HardDriveDownload,
		children: [
			{
				slug: 'latex',
				title: 'LaTeX',
				blurb: 'A TeX distribution: TeX Live, MacTeX, or MiKTeX.',
				icon: Sigma,
				children: [
					{ slug: 'windows', title: 'Windows', blurb: 'TeX Live from CTAN, or MiKTeX.', icon: Monitor },
					{ slug: 'macos', title: 'macOS', blurb: 'MacTeX, or BasicTeX for a smaller install.', icon: Apple },
					{ slug: 'linux', title: 'Linux', blurb: 'TeX Live from apt, or from upstream.', icon: TerminalSquare }
				]
			},
			{
				slug: 'typst',
				title: 'Typst',
				blurb: 'One program, tinymist.',
				icon: Type,
				children: [
					{ slug: 'windows', title: 'Windows', blurb: 'winget, or the standalone installer.', icon: Monitor },
					{ slug: 'macos', title: 'macOS', blurb: 'Homebrew, or the standalone installer.', icon: Apple },
					{ slug: 'linux', title: 'Linux', blurb: 'The installer script, or Homebrew.', icon: TerminalSquare }
				]
			}
		]
	},
	{
		slug: 'getting-started',
		title: 'Getting started',
		blurb: 'Open a folder, pick a main file, and understand what a save actually writes.',
		icon: Rocket
	},
	{
		slug: 'live-preview',
		title: 'Live preview',
		blurb: 'Pages typeset as you type, by your own TeX, with no manual compile step.',
		icon: Eye
	},
	{
		slug: 'visual-editing',
		title: 'Visual editing',
		blurb: 'Your .tex rendered as formatted text, math, figures, and tables, and saved back unchanged.',
		icon: PenLine,
		children: [
			{ slug: 'math', title: 'Equations', blurb: 'Inline and display math, numbered and referenced, with a symbol toolbar.', icon: Sigma },
			{ slug: 'images', title: 'Images', blurb: 'Drag, paste, or insert a figure; resize, caption, and number it visually.', icon: Image },
			{
				slug: 'tables',
				title: 'Tables',
				blurb: 'Insert by size, edit cells directly, merge, and control rules from a settings panel.',
				icon: Table
			},
			{
				slug: 'citations',
				title: 'Citations',
				blurb: 'Type @ for a picker across your bibliography and your own figures, tables, and equations.',
				icon: BookMarked
			},
			{
				slug: 'smart-selection',
				title: 'Smart selection',
				blurb: 'Select a whole block, then its parent, straight from the toolbar.',
				icon: BoxSelect
			}
		]
	},
	{
		slug: 'source-editing',
		title: 'Source editing',
		blurb: 'A full LaTeX code editor, with Vim and Emacs keymaps and multiple cursors.',
		icon: Code
	},
	{
		slug: 'spell-check',
		title: 'Spell check',
		blurb: 'Catches typos and grammar in your prose, and never flags your LaTeX.',
		icon: SpellCheck
	},
	{
		slug: 'intellisense',
		title: 'Intellisense',
		blurb: 'Completion, go-to-definition, and hover across your whole project.',
		icon: Sparkles
	},
	{
		slug: 'compiling',
		title: 'Compiling',
		blurb: 'Your own command, in a real shell, with the log read into a Problems panel.',
		icon: Play
	},
	{
		slug: 'projects',
		title: 'Projects and files',
		blurb: 'The folder is the project: explorer, tabs, multi-file documents, search, and references.',
		icon: Files
	},
	{
		slug: 'version-control',
		title: 'Version control',
		blurb: 'Stage, commit, and diff against the last commit without leaving the editor.',
		icon: GitBranch
	},
	{
		slug: 'comments',
		title: 'Comments',
		blurb: 'Select anything and leave a comment; threads follow the text as it changes.',
		icon: MessageSquare
	},
	{
		slug: 'collaboration',
		title: 'Real-time collaboration',
		blurb: 'Edit a folder with other people in real time, end to end encrypted, with no account.',
		icon: Users
	},
	{
		slug: 'integrations',
		title: 'Integrations',
		blurb: 'Other programs Texpile can talk to on your machine.',
		icon: Plug,
		children: [
			{ slug: 'zotero', title: 'Zotero', blurb: 'Insert citations from your library; needs the Better BibTeX plugin.', icon: Library },
			{
				slug: 'mcp',
				title: 'AI assistants (MCP)',
				blurb: 'Let Claude Code or Codex read your editor state and drive the app, locally.',
				icon: Bot
			}
		]
	}
];

export const hrefFor = (slug: string) => `/docs/${slug}`;

interface FlatEntry {
	topic: Topic;
	path: string;
	parent: Topic | null;
}

/** depth-first flattening (parent immediately followed by its children), for the pager and route
 * lookups. Computed once at module load; TOPICS is static per page render.
 *
 * Recursive rather than two nested loops, so nesting depth is a property of TOPICS alone: the
 * install pages are three deep (installation/latex/windows) and nothing here has to know that. */
const FLAT: FlatEntry[] = (() => {
	const out: FlatEntry[] = [];
	const walk = (topics: Topic[], prefix: string, parent: Topic | null) => {
		for (const t of topics) {
			const path = prefix ? `${prefix}/${t.slug}` : t.slug;
			out.push({ topic: t, path, parent });
			walk(t.children ?? [], path, t);
		}
	};
	walk(TOPICS, '', null);
	return out;
})();

/** prev/next for the footer pager; nulls at the ends. `path` is the full slug (e.g. "visual-editing/math"). */
export function siblings(path: string) {
	const i = FLAT.findIndex((e) => e.path === path);
	return {
		prev: i > 0 ? { slug: FLAT[i - 1].path, title: FLAT[i - 1].topic.title } : null,
		next: i >= 0 && i < FLAT.length - 1 ? { slug: FLAT[i + 1].path, title: FLAT[i + 1].topic.title } : null
	};
}

/** the topic (and its parent, if any) for a full slug path, for the sidebar's active-state and breadcrumb. */
export function lookup(path: string): { topic: Topic; parent: Topic | null } | null {
	const e = FLAT.find((e) => e.path === path);
	return e ? { topic: e.topic, parent: e.parent } : null;
}
