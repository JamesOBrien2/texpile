// one AST node to its block-level PM nodes, dispatching to the env/macro handler tables
// mutually recursive with convertNodesToBlocks in converter.ts; ESM live bindings make the circular import safe
import type { Node, Macro, Environment } from '@unified-latex/unified-latex-types';
import { printRaw } from '@unified-latex/unified-latex-util-print-raw';
import { getTextContent, isMathEnvironment, type RawStamped } from '../ast-utils';
import { buildNode, textNode, nodeToLatexString, type PmNode, type ConversionContext, type ConversionOptions } from '../builders';
import { ignoredMacros } from '../macros';
import { convertNodesToBlocks } from '../converter';
import { macroHandlers } from './macroHandlers';
import { envHandlers, transparentEnvironments } from './envHandlers';
import { VERBATIM_ENVS } from './blockKinds';
import { nodeRawSource, mathBodyRawSource } from './origCapture';
import { createBlockMath } from './mathConvert';

export function convertNodeToBlock(node: Node, ctx: ConversionContext, options: ConversionOptions): PmNode[] | null {
	switch (node.type) {
		case 'verbatim': {
			// unified-latex parses any environment it recognizes as genuinely verbatim-bodied
			// (verbatim, verbatim*, comment, filecontents, Verbatim, alltt, ...) into this
			// dedicated node shape instead of a generic 'environment' one, even though the
			// fields (env/content/args) match. Route it through the same envHandler-or-raw
			// fallback the 'environment' case uses, so e.g. `comment`/`filecontents` still
			// become an opaque raw_latex chip (per VERBATIM_ENVS) instead of looking like an
			// editable code block - only names with a dedicated handler (plain `verbatim`) do.
			const env = node as unknown as Environment;
			const envHandler = envHandlers[env.env];
			if (envHandler) return envHandler(env, ctx, options);
			const latexSource = nodeRawSource(node) ?? nodeToLatexString(node);
			return [buildNode('raw_latex', null, [textNode(latexSource)])];
		}
		case 'environment': {
			const env = node as Environment;
			const envHandler = envHandlers[env.env];
			if (envHandler) return envHandler(env, ctx, options);
			if (isMathEnvironment(env.env)) return createBlockMath(env, env.env.endsWith('*'));

			if (transparentEnvironments.has(env.env)) return convertNodesToBlocks(env.content, options);

			// verbatim-like / structural environments stay raw, byte-sliced when possible
			if (VERBATIM_ENVS.has(env.env)) {
				const latexSource = nodeRawSource(node) ?? nodeToLatexString(node);
				return [buildNode('raw_latex', null, [textNode(latexSource)])];
			}
			if (options.unknownHandling === 'ignore') return null;

			// default: auto-wrap any other environment as editable, carrying the \begin args
			// verbatim so e.g. minipage keeps its {width}.
			const envArgs = (env as Environment).args && (env as Environment).args!.length ? printRaw((env as Environment).args!) : '';
			const envInner = convertNodesToBlocks(env.content, options);
			return [buildNode('environment', { name: env.env, args: envArgs }, envInner.length > 0 ? envInner : [buildNode('paragraph')])];
		}
		case 'mathenv': {
			// the declared type says `env: string`, but some math envs hand back a nested node
			// instead; same declared-vs-actual gap as codeBlockFromVerbatimEnv's verbatim body.
			const mathEnv = node as Omit<Environment, 'env'> & { env: string | { content?: string } };
			const envName = typeof mathEnv.env === 'string' ? mathEnv.env : mathEnv.env?.content || 'equation';
			const starred = envName.endsWith('*');

			const lineLabels: string[] = [];
			const contentWithoutLabel: Node[] = [];

			for (const n of mathEnv.content || []) {
				if (n.type === 'macro' && n.content === 'label') {
					const mandatoryArgs = (n as Macro).args?.filter((arg) => arg.openMark === '{') || [];
					const labelText = mandatoryArgs[0] ? getTextContent(mandatoryArgs[0].content) : '';
					if (labelText) lineLabels.push(labelText);
				} else {
					contentWithoutLabel.push(n);
				}
			}

			// slice the exact source only when NO labels were extracted (the label text would
			// remain in the slice and get re-added, duplicating); printRaw fallback.
			let mathContent =
				(lineLabels.length === 0 ? mathBodyRawSource(node, [`\\begin{${envName}}`], [`\\end{${envName}}`]) : null) ??
				printRaw(contentWithoutLabel);
			// order matters: 'alignat'.startsWith('align'), so alignat/flalign must be checked
			// BEFORE the plain 'align' prefix (alignat also takes a {n} arg align doesn't, so the
			// misclassification can fail to compile).
			let environment: string | null = null;
			if (envName.startsWith('alignat')) environment = 'alignat';
			else if (envName.startsWith('flalign')) environment = 'flalign';
			else if (envName.startsWith('align')) environment = 'align';
			else if (envName.startsWith('gather')) environment = 'gather';
			// multline/eqnarray need `environment` set too, or their labels vanish on
			// regeneration (see the envHandlers comment).
			else if (envName.startsWith('multline')) environment = 'multline';
			else if (envName.startsWith('eqnarray')) environment = 'eqnarray';

			// the editor expects multiline environments wrapped in the content string
			const MULTILINE_ENVS = [
				'align',
				'align*',
				'gather',
				'gather*',
				'alignat',
				'alignat*',
				'flalign',
				'flalign*',
				'eqnarray',
				'eqnarray*',
				'multline',
				'multline*'
			];
			if (MULTILINE_ENVS.includes(envName)) {
				mathContent = `\\begin{${envName}}${mathContent}\\end{${envName}}`;
			}

			const label = lineLabels.length > 0 ? lineLabels[0] : null;
			return [
				buildNode('block_math', { label, numbered: !starred, environment, lineLabels }, [textNode(String(mathContent || '').trim())])
			];
		}
		case 'displaymath': {
			// slice the exact source between the delimiters; printRaw fallback
			const displayMathContent = mathBodyRawSource(node, ['\\[', '$$'], ['\\]', '$$']) ?? printRaw(node.content || []);
			return [
				buildNode('block_math', { label: null, numbered: false, environment: null, lineLabels: [] }, [
					textNode(String(displayMathContent || '').trim())
				])
			];
		}

		case 'macro': {
			const macro = node as Macro;
			// a commented call captured verbatim by the heuristics: emit as-is
			const rawMacro = macro as RawStamped<Macro>;
			if (rawMacro._raw != null) return [buildNode('raw_latex', null, [textNode(String(rawMacro._raw))])];
			if (ignoredMacros.has(macro.content)) return null;

			const handler = macroHandlers[macro.content];
			if (handler) {
				const result = handler(macro, ctx);
				// handlers returning block nodes are taken at face value; inline macros fall
				// through so they can be re-emitted inside a paragraph below.
				if (
					result &&
					result.length > 0 &&
					['heading', 'horizontal_rule', 'includedoc', 'abstract', 'image'].includes(result[0].type.name)
				) {
					return result;
				}
			}
			const handling = options.unknownHandling ?? 'raw_latex';
			if (handling === 'raw_latex') {
				const latexSource = nodeRawSource(node) ?? nodeToLatexString(node);
				if (String(latexSource || '').trim()) return [buildNode('raw_latex', null, [textNode(latexSource)])];
			}
			return null;
		}
		default:
			return null;
	}
}
