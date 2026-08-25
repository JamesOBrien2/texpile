-- Writes every SHIPPED PAGE's walker records + the pages.json manifest -- nothing else.
-- (Each page box is the engine's final exact layout: columns, floats, page breaks.)
-- Records go to <outdir>/page-NNN.jsonl. Registered from the .tex via the LaTeX kernel
-- shipout hook: \AddToHook{shipout/before}{\directlua{page_extract(\the\ShipoutBox)}}
--
-- Product config (set as Lua globals in the injecting job string before dofile):
--   TEXPILE_ENGINE_DIR -- absolute dir holding walker.lua (read-only; reads aren't
--                         sandboxed, so an absolute app-resources path is fine)
--   TEXPILE_DRAFT_OUT  -- relative subdir for the jsonl/manifest (writes ARE sandboxed;
--                         must be a relative path under cwd, e.g. "_draft")
-- ENGINE_DIR must be provided by the injecting job string; "." is only a last resort.
local ENGINE_DIR = TEXPILE_ENGINE_DIR or "."
local OUT = TEXPILE_DRAFT_OUT and (TEXPILE_DRAFT_OUT .. "/") or ""
local walker = dofile(ENGINE_DIR .. "/walker.lua")
local pageno = 0
local pages = {}

-- Counter truth for the instant path: a snapshot of the standard counters at every
-- \stepcounter/\setcounter (the job string wraps them), keyed by source line + input
-- file. The daemon pins to these TRUE values, so a heading/footnote/item patch can
-- reproduce the page's own numbers and certify instead of rendering a pinned 0.
local COUNTER_NAMES = { "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph",
	"footnote", "enumi", "enumii", "enumiii", "enumiv", "figure", "table", "equation" }
local counter_have -- probed once: which of these this document defines
local counter_log = {}
local body_line

function texpile_begindoc(line)
	body_line = line
end

function texpile_counters(line)
	if not counter_have then
		counter_have = {}
		for _, nm in ipairs(COUNTER_NAMES) do
			if pcall(function() return tex.count["c@" .. nm] end) then counter_have[#counter_have + 1] = nm end
		end
	end
	local vals = {}
	for _, nm in ipairs(counter_have) do
		vals[#vals + 1] = string.format('"%s":%d', nm, tex.count["c@" .. nm])
	end
	local f = ((status and status.filename or ""):gsub("\\", "/"):match("[^/]+$") or ""):gsub('[%c"\\]', "")
	local entry = string.format('{"l":%d,"f":"%s","s":{%s}}', line, f:lower(), table.concat(vals, ","))
	-- \stepcounter chains snapshot identically; keep one
	if counter_log[#counter_log] ~= entry then counter_log[#counter_log + 1] = entry end
end

-- Rewrite the manifest after EVERY shipout: \AtEndDocument hooks run BEFORE the final
-- \clearpage ships the last page, so an end-of-run write would miss it (a one-page
-- document would report count 0). The manifest is tiny; per-page rewrite is free.
local function write_manifest()
	local f = io.open(OUT .. "pages.json", "w")
	if not f then return end
	-- paper dims in TeX pt (same unit as the walker's glyph coords, so the renderer needs
	-- no bp/pt conversion). LaTeX's \paperwidth/\paperheight are named dimens.
	local pw = (tex.dimen and tex.dimen["paperwidth"] or 0) / 65536.0
	local ph = (tex.dimen and tex.dimen["paperheight"] or 0) / 65536.0
	-- \columnwidth is the exact width TeX wrapped body text to (one column in twocolumn
	-- mode); the instant patch calibrates the warm daemon to this so it reproduces the
	-- page's line breaks. Falls back to \textwidth (single-column docs) then 0.
	local cw = (tex.dimen and (tex.dimen["columnwidth"] or tex.dimen["textwidth"]) or 0) / 65536.0
	-- \textwidth too: under twocolumn a starred float wraps at THIS width, not \columnwidth,
	-- and the instant path needs the engine's value to calibrate full-width bands
	local tw = (tex.dimen and tex.dimen["textwidth"] or 0) / 65536.0
	-- \footskip separates the body bottom from the footer baseline (= the shipout box
	-- baseline, ht): body bottom in record space is ht - footskip
	local fsk = (tex.dimen and tex.dimen["footskip"] or 0) / 65536.0
	-- more engine registers the instant path used to guess: \columnsep (column origin
	-- synthesis), \baselineskip and \parskip (line-gap fallbacks and flow-gap bounds)
	local csep = (tex.dimen and tex.dimen["columnsep"] or 0) / 65536.0
	local bls, pks = 0, 0
	pcall(function() bls = tex.getglue("baselineskip") / 65536.0 end)
	pcall(function() pks = tex.getglue("parskip") / 65536.0 end)
	local t = {}
	for i = 1, pageno do
		local p = pages[i]
		-- the walker's certification reasons for THIS page (nil when it is fully renderable).
		-- The instant path has always had this per block; without it on the page the renderer
		-- had no way to know a page's records were unsafe to paint (RTL, in practice).
		local unc = p.unc and string.format(',"unc":"%s"', p.unc) or ""
		-- the shipped vpack's glue state: gsn 1 = the page was stretched to \textheight
		-- (flushbottom), so a patch must distribute its delta over the page's vg records
		-- the way a repack would, not shift rigidly
		t[i] = string.format('{"n":%d,"w":%.4f,"h":%.4f,"ht":%.4f,"gs":%.6f,"gsn":%d,"go":%d%s}',
			i, p.w, p.h, p.ht, p.gs or 0, p.gsn or 0, p.go or 0, unc)
	end
	f:write(string.format(
		'{"count":%d,"paperW":%.4f,"paperH":%.4f,"colW":%.4f,"textW":%.4f,"footSkip":%.4f,"colSep":%.4f,"blSkip":%.4f,"parSkip":%.4f%s,"pages":[%s]}',
		pageno, pw, ph, cw, tw, fsk, csep, bls, pks,
		body_line and string.format(',"bodyLine":%d', body_line) or "", table.concat(t, ",")))
	f:close()
	-- counter snapshots ride a sidecar (they are per-line, not per-page)
	local cf = io.open(OUT .. "counters.jsonl", "w")
	if cf then
		cf:write(table.concat(counter_log, "\n"))
		cf:close()
	end
end

function page_extract(boxnum)
	local b = tex.box[boxnum]
	if not b then return end
	pageno = pageno + 1
	-- The page's DIMENSIONS come from the box and are known whether or not the walk succeeds,
	-- so record them unconditionally. Registering them only on success left a hole in `pages`
	-- at the failed index, and the next page's write_manifest then indexed that nil and threw
	-- out of the shipout hook -- one bad page destroyed the manifest for the whole document.
	local ok, records, stats = pcall(walker.lines, b.head)
	pages[pageno] = {
		w = (b.width or 0) / 65536,
		h = ((b.height or 0) + (b.depth or 0)) / 65536,
		ht = (b.height or 0) / 65536,
		gs = b.glue_set or 0,
		gsn = b.glue_sign or 0,
		go = b.glue_order or 0,
		unc = ok and stats and stats.uncertified or nil
	}
	if ok then
		local f = io.open(string.format("%spage-%03d.jsonl", OUT, pageno), "w")
		if f then f:write(table.concat(records, "\n")); f:close() end
	end
	write_manifest()
end

-- kept for compatibility with existing wrappers; the real work happens per shipout
function page_extract_finish()
	write_manifest()
end
