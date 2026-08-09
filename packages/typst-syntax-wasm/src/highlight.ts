// Which Typst syntax kind gets which highlight tag.
//
// Adapted from codemirror-lang-typst (Apache-2.0, © Levi Zim) — see ../README.md. It is vendored
// rather than imported because that package's entry point re-exports its own wasm-backed parser,
// so importing anything from it pulled a SECOND 320KB parser into the bundle alongside ours. This
// file is pure data; the parser it describes is the one in ../src/lib.rs.
//
// The keys are Typst's SyntaxKind VARIANT names, which is what our wasm emits (see kind_name).
import { styleTags, tags } from '@lezer/highlight';

export const typstHighlight = styleTags({
	Shebang: tags.documentMeta,
	'LineComment BlockComment': tags.comment,

	Text: tags.content,
	Linebreak: tags.contentSeparator,
	Escape: tags.escape,
	Shorthand: tags.contentSeparator,
	SmartQuote: tags.quote,
	'Strong/...': tags.strong,
	'Emph/...': tags.emphasis,
	RawLang: tags.annotation,
	RawDelim: tags.controlKeyword,
	Raw: tags.monospace,
	Link: tags.link,
	Label: tags.labelName,
	'Ref/...': tags.labelName,
	'Heading/...': tags.heading,
	ListMarker: tags.list,
	EnumMarker: tags.list,
	TermMarker: tags.definitionOperator,

	MathText: tags.special(tags.string),
	MathIdent: tags.special(tags.variableName),
	'MathShorthand MathAlignPoint MathDelimited MathAttach MathPrimes MathFrac MathRoot': tags.special(tags.contentSeparator),

	Error: tags.invalid,

	Hash: tags.controlKeyword,
	'LeftBrace RightBrace': tags.brace,
	'LeftBracket RightBracket': tags.bracket,
	'LeftParen RightParen': tags.paren,
	Comma: tags.separator,
	'Semicolon Colon Dot Dots': tags.punctuation,
	Dollar: tags.controlKeyword,
	'Plus Minus Slash Hat': tags.arithmeticOperator,
	Prime: tags.typeOperator,
	'Eq PlusEq HyphEq SlashEq StarEq': tags.updateOperator,
	'EqEq ExclEq Lt LtEq Gt GtEq': tags.compareOperator,
	Arrow: tags.controlOperator,
	Root: tags.arithmeticOperator,

	'Not And Or': tags.operatorKeyword,
	'None Auto': tags.literal,
	'If Else For While Break Continue Return': tags.controlKeyword,
	'Import Include': tags.moduleKeyword,
	'Let Set Show Context': tags.definitionKeyword,
	'As In': tags.operatorKeyword,

	Code: tags.monospace,
	// the called name, not every ident: #image(..) colours like a LaTeX \command does, while a
	// plain variable stays uncoloured the way other languages leave variables
	'FuncCall/Ident': tags.function(tags.variableName),
	Ident: tags.variableName,
	Bool: tags.bool,
	Int: tags.integer,
	Float: tags.float,
	Numeric: tags.number,
	Str: tags.string
});
