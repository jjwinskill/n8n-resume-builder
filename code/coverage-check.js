// ───────────────────────────────────────────────────────────
// Coverage Check — deterministic keyword-coverage measurement,
// deterministic redaction, and deterministic rendered-length
// estimation. No LLM self-grading: we regex-match the JD's required
// and preferred keywords against the actual resume text, scrub the
// redacted terms, and measure the page cost in lines.
// ───────────────────────────────────────────────────────────
const REQUIRED_TARGET = 0.8;

function resumeToText(r) {
  const parts = [r.summary, r.location_line];
  for (const g of r.skills || []) parts.push(g.group, ...(g.items || []));
  for (const e of r.experience || []) {
    parts.push(e.employer, e.employer_title, e.employer_summary);
    for (const en of e.engagements || []) parts.push(en.client, en.role, en.industry, ...(en.bullets || []));
  }
  for (const p of r.projects || []) parts.push(p.name, p.description, ...(p.bullets || []));
  for (const ed of r.education || []) parts.push(ed.school, ed.credential);
  return parts.filter(Boolean).join('\n');
}

function hasKeyword(text, kw) {
  const escaped = String(kw).trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '[\\s\\-/]*');
  if (!escaped) return true;
  return new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)', 'i').test(text);
}

function computeCoverage(resume, job_data) {
  const text = resumeToText(resume);
  const req = (job_data.keywords_required || []).map(String).filter(Boolean);
  const pref = (job_data.keywords_preferred || []).map(String).filter(Boolean);
  const matchedReq = req.filter((k) => hasKeyword(text, k));
  const matchedPref = pref.filter((k) => hasKeyword(text, k));
  return {
    target: REQUIRED_TARGET,
    required_total: req.length,
    required_matched: matchedReq.length,
    required_ratio: req.length ? Number((matchedReq.length / req.length).toFixed(3)) : 1,
    missing_required: req.filter((k) => !hasKeyword(text, k)),
    preferred_total: pref.length,
    preferred_matched: matchedPref.length,
    missing_preferred: pref.filter((k) => !hasKeyword(text, k)),
    matched_keywords: [...matchedReq, ...matchedPref],
    word_count: text.split(/\s+/).filter(Boolean).length,
  };
}

// ── Deterministic redaction scrub ─────────────────────────────
// The redaction rule lives in three prompts and was still violated on
// roughly one run in four, because a prompt is a request and not a
// guarantee. This makes it a guarantee. Terms come from House Rules
// config, so there is one list rather than three.
function scrubResume(resume, config) {
  const terms = (config && config.redacted_terms) || [];
  const replacement = (config && config.redaction_replacement) || '[redacted]';
  if (!terms.length) return { resume, redactions: [] };

  const patterns = terms
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => ({ term: t, re: new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') }));

  const redactions = [];
  const walk = (v, path) => {
    if (typeof v === 'string') {
      let out = v;
      for (const p of patterns) {
        if (p.re.test(out)) {
          redactions.push({ term: p.term, path });
          out = out.replace(p.re, replacement);
        }
        p.re.lastIndex = 0;
      }
      return out;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k], path ? `${path}.${k}` : k);
      return o;
    }
    return v;
  };

  return { resume: walk(resume, ''), redactions };
}

// ── Rendered-length estimator ─────────────────────────────────
// Length used to be budgeted in words, which is why five consecutive
// runs shaved words off every bullet and still rendered three pages:
// the renderer bills in LINES. A 128-character bullet and a 106-character
// bullet both occupy two lines, so removing three words from the first
// one removes nothing at all.
//
// Every constant below is read directly off the Render HTML node's own
// CSS - @page letter with 0.65in margins, body Arial 10.5pt/1.35, and
// the exact margins on h2, .entry-head, .entry-title, .entry-sub,
// .engagement-head, ul, li, .skill and .edu. The single fitted value is
// AVG_CHAR_EM: Arial's average advance width as a fraction of font size
// over prose of this kind. 0.46 reproduces the last accepted two-page
// resume at 2.00 pages; the surrounding values give 1.96 at 0.45 and
// 2.08 at 0.48, so the estimate is stable at roughly one line of
// sensitivity per 0.01.
const AVG_CHAR_EM = 0.46;
const PT = {
  BODY_LINE: 10.5 * 1.35,
  SMALL_LINE: 9.5 * 1.35,
  TITLE_LINE: 11 * 1.35,
  PAGE: (11 - 0.65 * 2) * 72,
  BODY_WIDTH: (8.5 - 0.65 * 2) * 72,
};
const H2_PT = 10.5 * 1.35 + 1.5 + 0.9 + 9 + 4.5;
const CHAR_PT = 10.5 * AVG_CHAR_EM;
const BULLET_CHARS = Math.floor((PT.BODY_WIDTH - 12) / CHAR_PT);
const FULL_CHARS = Math.floor(PT.BODY_WIDTH / CHAR_PT);
const LINE_BUDGET = Math.floor((2 * PT.PAGE) / PT.BODY_LINE);
const WASTE_THRESHOLD = 45;

function wrapLines(text, chars) {
  return Math.max(1, Math.ceil(String(text || '').length / chars));
}

function bulletWaste(text, chars) {
  const len = String(text || '').length;
  const lines = Math.max(1, Math.ceil(len / chars));
  const lastLineChars = len - (lines - 1) * chars;
  return { lines, last_line_chars: lastLineChars, wasted_chars: chars - lastLineChars };
}

function estimateLayout(r) {
  let pt = 0;
  const wasteful = [];

  // Header: h1 19pt + .contact lines.
  pt += 19 * 1.35 + 2.25;
  pt += 2 * (PT.SMALL_LINE + 1.5);

  // Summary.
  pt += H2_PT + 6 + wrapLines(r.summary, FULL_CHARS) * PT.BODY_LINE;

  // Skills.
  pt += H2_PT;
  for (const g of r.skills || []) {
    pt += 2.25 + wrapLines(`${g.group}: ${(g.items || []).join(', ')}`, FULL_CHARS) * PT.BODY_LINE;
  }

  // Experience.
  pt += H2_PT;
  for (const emp of r.experience || []) {
    pt += 6.75 + PT.TITLE_LINE;
    if (emp.employer_summary) pt += 3.75 + PT.SMALL_LINE;
    for (const en of emp.engagements || []) {
      pt += 6 + PT.BODY_LINE + 6;
      for (const b of en.bullets || []) {
        const w = bulletWaste(b, BULLET_CHARS);
        pt += w.lines * PT.BODY_LINE + 1.875;
        if (w.lines > 1 && w.wasted_chars >= WASTE_THRESHOLD) {
          wasteful.push({
            client: en.client,
            bullet: b,
            lines: w.lines,
            characters: String(b || '').length,
            wasted_chars: w.wasted_chars,
            hint: `cut ~${w.last_line_chars} characters to drop a full line`,
          });
        }
      }
    }
  }

  // Projects.
  if ((r.projects || []).length) {
    pt += H2_PT;
    for (const p of r.projects) {
      pt += 6.75 + PT.TITLE_LINE + (p.description ? 3.75 + PT.SMALL_LINE : 0) + 6;
      for (const b of p.bullets || []) pt += wrapLines(b, BULLET_CHARS) * PT.BODY_LINE + 1.875;
    }
  }

  // Education.
  pt += H2_PT;
  for (const _ of r.education || []) pt += 4.5 + PT.BODY_LINE;

  // Floor, not round. A document that ends partway through its 98th line has
  // not spilled onto a third page, and rounding up failed the last resume that
  // was actually accepted (it estimates at 98.6 lines).
  const estimatedLines = Math.floor(pt / PT.BODY_LINE);
  wasteful.sort((a, b) => b.wasted_chars - a.wasted_chars);

  return {
    estimated_lines: estimatedLines,
    line_budget: LINE_BUDGET,
    estimated_pages: Number((pt / PT.PAGE).toFixed(2)),
    over_by_lines: Math.max(0, estimatedLines - LINE_BUDGET),
    chars_per_bullet_line: BULLET_CHARS,
    chars_per_full_line: FULL_CHARS,
    wasteful_bullets: wasteful.slice(0, 6),
  };
}

const raw = $json.output;
if (!raw || !raw.experience) {
  throw new Error('Resume Generator output is missing or malformed');
}
const ctx = $('Merge Thesis').first().json;
const { resume, redactions } = scrubResume(raw, ctx.config);

return {
  resume,
  job_data: ctx.job_data,
  coverage: computeCoverage(resume, ctx.job_data),
  layout: estimateLayout(resume),
  redactions,
  thesis: ctx.thesis || null,
  houseRules: ctx.houseRules || '',
  config: ctx.config,
};
