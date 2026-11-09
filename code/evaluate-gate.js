// ─────────────────────────────────────────────────────────────
// Evaluate Gate
// Combines three independent signals:
//   1. QA's semantic pass/fail judgement
//   2. QA's required_match_ratio against a target
//   3. Deterministic structural checks (budgets, banned text, counts)
//
// Structural rules live here rather than in a prompt because the LLM
// has proven unreliable at counting and self-censoring.
//
// NOTE ON ORDERING: engagement order is no longer checked here.
// 'Render HTML' now sorts engagements mechanically by end date, so a
// misordered model output can no longer reach the PDF. Failing the gate
// on ordering would only burn a refine pass on an already-solved problem.
// Unparseable dates ARE still failed, because the sort depends on them.
// ─────────────────────────────────────────────────────────────

// This node now runs on BOTH passes. On the first pass it is fed by QA Review,
// whose payload is { output: <qa> }. On the second pass it is fed by Coverage
// Recheck, whose payload already carries { resume, job_data, coverage, qa } and
// is marked status:'refined'. Refined output used to go straight to the
// renderer, which meant every rule in this file was silently skipped whenever a
// refine happened - the single largest correctness hole in the workflow.
/** @type {any} */
const incoming = $json || {};
const isRefinedPass = incoming.status === 'refined';

// LOOP TERMINATION. This node sits in the only cycle in the workflow:
//   Evaluate Gate -> IF Passed QA -> Refine Resume -> Coverage Recheck -> here
// The cycle's only exit is gate_pass === true, so the guard below is the sole
// thing preventing an infinite loop and must not depend on a single runtime
// variable behaving as expected.
//
// isRefinedPass is the primary guard and is structurally guaranteed: Coverage
// Recheck runs only after Refine Resume, so status === 'refined' is proof that
// a refine has already happened. Once it has, this pass is final.
//
// $runIndex is a secondary guard only. If it is unavailable or does not
// increment, the primary guard still terminates the loop.
const attempt = (typeof $runIndex === 'number' ? $runIndex : 0) + 1;
const MAX_ATTEMPTS = 2;

/** @type {any} */
const qa = isRefinedPass ? (incoming.qa || {}) : incoming.output;

if (!qa || typeof qa.pass !== 'boolean') {
  throw new Error(
    isRefinedPass
      ? 'Coverage Recheck did not carry the QA payload forward'
      : 'QA Review output is missing or malformed'
  );
}
if (typeof qa.required_match_ratio !== 'number') {
  throw new Error('QA Review did not return required_match_ratio');
}

/** @type {any} */
const prev = isRefinedPass ? incoming : $('Coverage Check').first().json;

/** @type {any} */
const resume = prev.resume || {};

// ── Tunables ─────────────────────────────────────────────────
// Length is no longer budgeted in words. The renderer bills in LINES, and
// the old word ceiling is what let five consecutive runs shave words off
// every bullet without removing a single rendered line. Coverage Check now
// computes the line cost from the renderer's own CSS and hands it over in
// prev.layout, so the check below is a comparison rather than a proxy.
//
// The engagement ceiling was also a bad proxy. It was inferred from the
// observation that six engagements rendered onto a third page, but the real
// cost of an extra engagement is about 1.5 lines of heading overhead - the
// third page came from bullet volume. Holding the ceiling at 5 deleted
// engagements the candidate actually worked, and produced a resume with a
// visible multi-year hole in it. Continuity is checked in check 18 and it
// outranks every other selection rule.
//
// 2026-09-28: the engagement-count and total-bullet ceilings were removed.
// The line budget is the only length control; the per-engagement bullet cap
// stays because it is about readability, not length.
const SEMANTIC_TARGET = 0.7;
const SUMMARY_WORD_MAX = 75;
const SUMMARY_SENTENCE_MAX = 3;

const SKILL_GROUP_MAX = 7;
const SKILL_ITEMS_MAX = 8;
const BULLETS_PER_ENGAGEMENT_MAX = 5;

// USER CONFIGURATION, not classification logic, and no longer duplicated here.
// Both of these now come from the House Rules node so that the prompts and the
// deterministic checks cannot drift apart. ALWAYS_INCLUDE_CLIENTS lists clients
// that must appear regardless of relevance scoring; it never outranks
// continuity. BANNED_STRINGS are already scrubbed deterministically in Coverage
// Check, so the check below is a safety net rather than the enforcement point.
const config = prev.config || {};
const ALWAYS_INCLUDE_CLIENTS = config.always_include_clients || [];
const BANNED_STRINGS = (config.redacted_terms || []).map((t) => String(t).toLowerCase());
const MAX_GAP_MONTHS = Number(config.max_gap_months) || 4;
const MAX_TRAILING_GAP_MONTHS = Number(config.max_trailing_gap_months) || 8;

const structural_failures = [];

// ── Date helpers ─────────────────────────────────────────────
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Convert "Mon YYYY" to a sortable integer. Returns -1 when unparseable.
function monthValue(token) {
  const t = String(token || '').trim();
  if (/present|current|ongoing/i.test(t)) return 999999;
  const m = t.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (!m) return -1;
  const mi = MONTHS[m[1].toLowerCase()];
  if (mi === undefined) return -1;
  return Number(m[2]) * 12 + mi;
}

// Split "Mon YYYY - Mon YYYY" into { start, end } sortable integers.
function parseRange(range) {
  const raw = String(range || '');
  const parts = raw.split(/\s*[-–—]\s*|\s+to\s+/i);
  if (parts.length < 2) return { start: monthValue(raw), end: monthValue(raw) };
  return {
    start: monthValue(parts[0]),
    end: monthValue(parts[parts.length - 1]),
  };
}

// ── Flatten resume text for substring scanning ───────────────
function resumeText(r) {
  const parts = [r.summary, r.location_line];
  for (const g of r.skills || []) {
    parts.push(g.group, ...(g.items || []));
  }
  for (const e of r.experience || []) {
    parts.push(e.employer, e.employer_title, e.employer_dates, e.employer_summary);
    for (const en of e.engagements || []) {
      parts.push(en.client, en.role, en.industry, en.dates, ...(en.bullets || []));
    }
  }
  for (const p of r.projects || []) {
    parts.push(p.name, p.description, ...(p.bullets || []));
  }
  for (const ed of r.education || []) {
    parts.push(ed.school, ed.credential, ed.location, ed.year);
  }
  return parts.filter(Boolean).join('\n');
}

const flatText = resumeText(resume);
const flatLower = flatText.toLowerCase();
const summary = String(resume.summary || '');
const summaryLower = summary.toLowerCase();

// ── Check 1: dates must be parseable and inside the employer range
const entries = Array.isArray(resume.experience) ? resume.experience : [];

entries.forEach((entry, entryIndex) => {
  const engagements = Array.isArray(entry.engagements) ? entry.engagements : [];
  const ranges = engagements.map((en) => parseRange(en.dates));

  ranges.forEach((r, i) => {
    if (r.end === -1 || r.start === -1) {
      const label = engagements[i].client || `position ${i + 1}`;
      structural_failures.push(
        `Engagement "${label}" has an unparseable date range ("${engagements[i].dates}"). ` +
        `Use the format "Mon YYYY - Mon YYYY". Chronological sorting depends on this.`
      );
    }
  });

  // Engagements must fall inside the umbrella employer date range.
  const employerRange = parseRange(entry.employer_dates);
  if (employerRange.end !== -1) {
    engagements.forEach((en, i) => {
      const r = ranges[i];
      if (r.end !== -1 && r.end > employerRange.end) {
        structural_failures.push(
          `Engagement "${en.client}" ends after the employer range ` +
          `"${entry.employer_dates}". Correct one of the two.`
        );
      }
      if (r.start !== -1 && employerRange.start !== -1 && r.start < employerRange.start) {
        structural_failures.push(
          `Engagement "${en.client}" starts before the employer range ` +
          `"${entry.employer_dates}". Correct one of the two.`
        );
      }
    });
  }

  if (!engagements.length) {
    structural_failures.push(
      `Experience entry ${entryIndex + 1} ("${entry.employer}") has no engagements.`
    );
  }
});

// ── Check 2: professional summary budget
const summaryWords = summary.trim().split(/\s+/).filter(Boolean).length;
if (summaryWords > SUMMARY_WORD_MAX) {
  structural_failures.push(
    `Professional summary is ${summaryWords} words, above the ${SUMMARY_WORD_MAX}-word ` +
    `ceiling. Reduce to 55-${SUMMARY_WORD_MAX} words in at most ${SUMMARY_SENTENCE_MAX} sentences.`
  );
}

// ── Check 3: aspirational and hedging language anywhere
const BANNED_PHRASES = [
  'eager to',
  'excited to',
  'looking forward',
  'passionate about',
  'seeking to',
  'hoping to',
  'would love to',
  'aspire',
  'ready to bring',
  'poised to',
  'keen to',
  'enthusiastic about',
];

BANNED_PHRASES.forEach((phrase) => {
  if (flatLower.includes(phrase)) {
    structural_failures.push(
      `Contains aspirational language: "${phrase}". A resume states demonstrated ` +
      `evidence. If evidence for a requirement does not exist, omit the topic ` +
      `entirely rather than expressing interest in it.`
    );
  }
});

// ── Check 4: hedged skill nouns that fake partial possession
const HEDGE_SUFFIXES = /\b\S+[- ](thinking|mindset|awareness|exposure|adjacent)\b/i;
for (const g of resume.skills || []) {
  for (const item of g.items || []) {
    if (HEDGE_SUFFIXES.test(String(item))) {
      structural_failures.push(
        `Skills entry "${item}" is a softened variant of a real skill. ` +
        `Either claim the actual practice using the posting's own term when the ` +
        `Super Resume supports it, or remove the entry.`
      );
    }
  }
}

// ── Check 5: mirrored posting adjectives in the summary
const MIRRORED = ['results-driven', 'process-oriented', 'self-starter', 'fast-paced', 'detail-oriented'];
MIRRORED.forEach((phrase) => {
  if (summaryLower.includes(phrase)) {
    structural_failures.push(
      `Summary echoes the posting's own adjective "${phrase}". Demonstrate the ` +
      `trait through concrete evidence instead of restating the posting.`
    );
  }
});

// ── Check 6: eligibility arguments belong in Education
if (/equivalent[- ]combination|equivalency|equivalent-experience|four-year bachelor/i.test(summary)) {
  structural_failures.push(
    'Summary contains a degree-equivalency or eligibility argument. Move it to a ' +
    'single short note in the Education section.'
  );
}

// ── Check 7: skills section discipline
const groups = Array.isArray(resume.skills) ? resume.skills : [];
if (groups.length > SKILL_GROUP_MAX) {
  structural_failures.push(
    `Skills has ${groups.length} groups. Reduce to at most ${SKILL_GROUP_MAX}, ` +
    `ordered by the posting's emphasis.`
  );
}
groups.forEach((g) => {
  const count = (g.items || []).length;
  if (count > SKILL_ITEMS_MAX) {
    structural_failures.push(
      `Skills group "${g.group}" has ${count} items. Reduce to at most ${SKILL_ITEMS_MAX}.`
    );
  }
});

// ── Check 8: redacted third-party names must not leak
BANNED_STRINGS.forEach((banned) => {
  if (flatLower.includes(banned)) {
    structural_failures.push(
      `The resume contains the redacted third-party name "${banned}". Refer to it ` +
      `generically as a third-party vendor platform and never by name.`
    );
  }
});

// ── Check 9: rendered length budget, measured in lines
// Words were never the constraint. A bullet occupies ceil(chars / 104) lines
// whatever its word count, so the instruction "tighten bullets" reliably
// reduced the word count and left the page count untouched. The estimator in
// Coverage Check reads the renderer's own CSS, and it also reports which
// bullets are wasting most of their final line - those are the only edits that
// actually remove a line, so name them instead of asking for a general trim.
const layout = prev.layout || {};
const estimatedLines = Number(layout.estimated_lines) || 0;
const lineBudget = Number(layout.line_budget) || 98;
if (estimatedLines > lineBudget) {
  const cheapest = (layout.wasteful_bullets || []).slice(0, 3).map(
    (w) => `"${String(w.bullet).slice(0, 60)}..." (${w.client}, ${w.lines} lines, ` +
           `final line only ${w.last_line_chars} of ${layout.chars_per_bullet_line} characters)`
  );
  structural_failures.push(
    `Rendered length is about ${estimatedLines} lines against a ${lineBudget}-line ` +
    `two-page budget, an overflow of ${estimatedLines - lineBudget} lines ` +
    `(${layout.estimated_pages} pages). Remove or merge whole bullets. Do not shave ` +
    `words evenly across every bullet: that lowers the word count without lowering ` +
    `the line count.` +
    (cheapest.length
      ? ` The cheapest lines to reclaim are bullets whose final line is nearly ` +
        `empty: ${cheapest.join(' | ')}.`
      : '')
  );
}

// ── Check 10: bullets per engagement (readability, not length)
// Length is governed only by the line budget; there is no engagement-count
// or total-bullet ceiling.
entries.forEach((entry) => {
  const engagements = Array.isArray(entry.engagements) ? entry.engagements : [];
  engagements.forEach((en) => {
    const n = (en.bullets || []).length;
    if (n > BULLETS_PER_ENGAGEMENT_MAX) {
      structural_failures.push(
        `Engagement "${en.client}" has ${n} bullets, above the ` +
        `${BULLETS_PER_ENGAGEMENT_MAX}-bullet ceiling.`
      );
    }
  });
});

// -- Check 11: career-trajectory and self-limiting language ---
// A resume must never narrate how recently the candidate acquired a skill,
// nor advertise the specialization they are moving away from. Both hand a
// reviewer a reason to reject, and both are evidence-free self-assessment,
// which is out of scope for the document entirely.
const TRAJECTORY_PATTERNS = [
  {
    re: /\b(ramp|ramped|ramping|pivot|pivoted|pivoting|transition|transitioned|transitioning|expand|expanded|expanding|grew|growing|moved|moving|shifted|shifting)\s+(from|into|toward|towards)\b/i,
    why: 'narrates a career transition instead of stating completed work',
  },
  {
    re: /\bwithin\s+(a\s+few|one|two|three|four|five|six|1|2|3|4|5|6)\s+(week|weeks|month|months)\b/i,
    why: 'quantifies how briefly the candidate has done something',
  },
  {
    re: /\b[a-z]+-(dominant|leaning|heavy)\b/i,
    why: 'labels the candidate with a narrower specialization than the role wants',
  },
  {
    re: /\b(new to|recently began|recently started|still developing|learning curve|upskilling|reskilling)\b/i,
    why: 'admits inexperience',
  },
  {
    re: /\b(quick learner|fast learner|learns quickly|picks up new|adaptable to new technologies)\b/i,
    why: 'substitutes a learning-speed claim for evidence',
  },
];

TRAJECTORY_PATTERNS.forEach((rule) => {
  const hit = flatText.match(rule.re);
  if (hit) {
    structural_failures.push(
      `Contains "${hit[0]}", which ${rule.why}. Delete the clause entirely. ` +
      `Replace it with a concrete accomplishment already proven by a bullet, ` +
      `or say nothing.`
    );
  }
});

// -- Check 12: narrowing parentheticals in skills --------------
// "Kubernetes (Helm charts)" claims a technology and then quietly
// shrinks the claim. An acronym in parentheses is fine; prose is not.
for (const g of resume.skills || []) {
  for (const item of g.items || []) {
    const paren = String(item).match(/\(([^()]+)\)/);
    if (!paren) continue;
    const inside = paren[1].trim();
    const isAcronym = /^[A-Z0-9][A-Z0-9/&+.-]{1,11}$/.test(inside);
    if (!isAcronym) {
      structural_failures.push(
        `Skills entry "${item}" uses a parenthetical to narrow the claim. Claim ` +
        `the skill plainly when the Super Resume supports it, or remove the ` +
        `entry. Parentheses may only contain an acronym for the same term.`
      );
    }
  }
}

// -- Check 13: malformed metrics --------------------------------
// "3-4+ regions" is not a number a reviewer can trust. Pick one figure.
const badRange = flatText.match(/\b\d+\s*[-\u2013\u2014]\s*\d+\s*\+/);
if (badRange) {
  structural_failures.push(
    `Contains the malformed figure "${badRange[0]}". A metric must be a single ` +
    `unambiguous number. When the Super Resume gives a range, state the lower ` +
    `bound with no plus sign.`
  );
}

// -- Check 14: every engagement needs a role -------------------
entries.forEach((entry) => {
  (entry.engagements || []).forEach((en) => {
    if (!String(en.role || '').trim()) {
      structural_failures.push(
        `Engagement "${en.client || 'unnamed'}" has no role. Every engagement ` +
        `needs the title actually held, taken from the Super Resume engagement ` +
        `header, so a resume parser can associate a job title with each date range.`
      );
    }
  });
});

// -- Check 15: recognition notes must describe the actual resume ----
// This check used to enforce recognition-based selection as a rule, and it
// blocked on two conditions it should never have blocked on: that the
// displaced engagement was the sole evidence for a requirement, and that the
// recognized client evidenced no requirement at all. Both of those are
// arguments for not making the swap, not for failing a finished resume - and
// with continuity now mandatory, a recognition swap can no longer quietly
// delete a needed engagement in the first place. Recognition is a tiebreaker.
//
// What remains is the part that is a genuine factual error: notes that
// describe a resume that was not produced. That stays blocking, because the
// notes are the audit trail.
const recognition = ((resume.ats_notes || {}).recognition_selections) || [];
const engagementClients = new Set();
entries.forEach((entry) => {
  (entry.engagements || []).forEach((en) => {
    if (en.client) engagementClients.add(String(en.client).trim().toLowerCase());
  });
});

if (recognition.length > 1) {
  structural_failures.push(
    `${recognition.length} engagements were selected on name recognition. At most ` +
    `one slot may be spent this way. Keep the strongest recognized client and ` +
    `select the rest on relevance and continuity.`
  );
}

recognition.forEach((sel) => {
  const inc = String(sel.included_client || '').trim();
  const out = String(sel.displaced_client || '').trim();

  if (inc && !engagementClients.has(inc.toLowerCase())) {
    structural_failures.push(
      `Recognition swap claims "${inc}" was included, but no engagement has that ` +
      `client. The notes must describe the resume that was actually produced.`
    );
  }
  if (out && engagementClients.has(out.toLowerCase())) {
    structural_failures.push(
      `Recognition swap claims "${out}" was displaced, but it is still present as ` +
      `an engagement. Either remove it or correct the notes.`
    );
  }
});

// -- Check 16: summary sentence count --------------------------
// The three-sentence rule was prompt-only, and a four-sentence summary shipped.
// Anything stated as a rule the model must follow belongs here instead.
const summaryText = String(resume.summary || '').trim();
const summarySentences = summaryText
  .split(/(?<=[.!?])\s+/)
  .map((x) => x.trim())
  .filter(Boolean);
if (summarySentences.length > SUMMARY_SENTENCE_MAX) {
  structural_failures.push(
    `The professional summary is ${summarySentences.length} sentences, over the ` +
    `${SUMMARY_SENTENCE_MAX}-sentence ceiling. Merge or delete sentences rather ` +
    `than shortening every one of them. The weakest sentence is usually the ` +
    `generic capability list.`
  );
}

// -- Check 17: always-include clients --------------------------
// Configured client names outrank relevance scoring. See ALWAYS_INCLUDE_CLIENTS.
const selectedClients = new Set();
entries.forEach((entry) => {
  (entry.engagements || []).forEach((en) => {
    if (en.client) selectedClients.add(String(en.client).trim().toLowerCase());
  });
});
ALWAYS_INCLUDE_CLIENTS.forEach((name) => {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return;
  const present = [...selectedClients].some(
    (c) => c === wanted || c.startsWith(wanted + ' ') || c.includes(wanted)
  );
  if (!present) {
    structural_failures.push(
      `"${name}" is a required engagement on every resume and is missing. ` +
      `Include it; if that pushes the resume over the line budget, take the lines ` +
      `back from the least relevant engagement's bullets. Never close this failure by dropping an ` +
      `engagement that check 18 needs, and never invent content for it - use ` +
      `only what the Super Resume states for that client.`
    );
  }
});

// -- Check 18: chronological continuity ------------------------
// The most damaging defect this pipeline ever shipped, and it was invisible to
// every other check: relevance-only selection under a hard 5-engagement
// ceiling deleted engagements the candidate actually worked and left a
// multi-year hole in the middle of a continuous employment history. A reviewer cannot distinguish an
// engagement that was optimized away from a period of unemployment, and they
// assume the second. This is mechanically checkable, so it is checked here and
// not left to a prompt.
const nowMonths = (() => {
  const d = new Date();
  return d.getFullYear() * 12 + d.getMonth();
})();

entries.forEach((entry) => {
  const label = entry.employer || 'this employer';
  const ranges = (entry.engagements || [])
    .map((en) => ({ client: en.client || 'unnamed engagement', ...parseRange(en.dates) }))
    .filter((r) => r.start >= 0 && r.end >= 0)
    .sort((a, b) => a.start - b.start);
  if (!ranges.length) return;

  const empRange = parseRange(entry.employer_dates);

  // Gap between the umbrella start and the earliest engagement shown.
  if (empRange.start >= 0 && ranges[0].start - empRange.start > MAX_GAP_MONTHS) {
    structural_failures.push(
      `${label} is dated from ${String(entry.employer_dates).split(/\s*[-–—]\s*/)[0]} ` +
      `but the earliest engagement shown starts ${ranges[0].start - empRange.start} months ` +
      `later. Add the engagement from the Super Resume that covers the opening ` +
      `interval. Chronological continuity outranks relevance: a visible gap reads ` +
      `as unemployment. Never close this by changing a date.`
    );
  }

  // Gaps between consecutive engagements. Overlaps cover for each other, so
  // track the furthest end reached rather than the previous engagement's end.
  let reach = ranges[0].end;
  let reachClient = ranges[0].client;
  for (let i = 1; i < ranges.length; i += 1) {
    const r = ranges[i];
    const gap = r.start - reach;
    if (gap > MAX_GAP_MONTHS) {
      structural_failures.push(
        `Uncovered interval of ${gap} months between "${reachClient}" and ` +
        `"${r.client}" under ${label}. Add the engagement from the Super Resume ` +
        `that covers it, even if it holds only one bullet. If that exceeds the ` +
        `line budget, reclaim the lines from the least relevant engagement's ` +
        `bullets. Do not drop an engagement to make room for it, and do not ` +
        `adjust any date.`
      );
    }
    if (r.end > reach) {
      reach = r.end;
      reachClient = r.client;
    }
  }
});

// Gap between the most recent engagement anywhere on the resume and today.
const allEnds = entries.flatMap((entry) =>
  (entry.engagements || []).map((en) => parseRange(en.dates).end)
).filter((v) => v >= 0);
if (allEnds.length) {
  const latest = Math.max(...allEnds);
  // A trailing gap is a different thing from an interior one and gets a wider
  // tolerance. An interior hole looks like a job loss the candidate is hiding.
  // A few months between the last engagement and today is just "currently
  // looking", which is true of everyone who is applying.
  if (latest < 900000 && nowMonths - latest > MAX_TRAILING_GAP_MONTHS) {
    structural_failures.push(
      `The most recent engagement ended ${nowMonths - latest} months ago. When the ` +
      `Super Resume documents any professional activity since then, emit it as its ` +
      `own experience entry outside the employer umbrella with its own employer, ` +
      `title and date range. When it documents nothing, record the interval in ` +
      `ats_notes.coverage_gaps and leave the resume alone.`
    );
  }
}

// ── Combine signals ──────────────────────────────────────────
const semanticCoverageOk = qa.required_match_ratio >= SEMANTIC_TARGET;
const structural_ok = structural_failures.length === 0;
// QA Review does NOT re-run on the refined pass. Coverage Recheck carries the
// pass-1 verdict forward, so on a refined pass qa.pass and required_match_ratio
// are stale: Refine Resume may have fixed the very things QA objected to, or
// may not have. Treating a stale verdict as live is wrong in both directions,
// so the refined pass is judged on the deterministic checks alone and the
// semantic verdict is reported as unverified rather than as a failure.
const semantic_verified = !isRefinedPass;
const clean = isRefinedPass
  ? structural_ok
  : (Boolean(qa.pass) && semanticCoverageOk && structural_ok);

// A rule the refine pass cannot satisfy degrades into a visible warning
// instead of an endless loop. Anything left in unresolved_failures needs a
// human decision.
const exhausted = isRefinedPass || attempt >= MAX_ATTEMPTS;
const gate_pass = clean || exhausted;

// Only real, still-present problems belong here. A stale semantic verdict is
// not a problem, it is an absence of evidence, and it is reported separately
// via semantic_verified so an empty warning list never appears alongside a
// warning status.
const unresolved_failures = clean ? [] : structural_failures.slice();
const advisories = [];
if (isRefinedPass && !(Boolean(qa.pass) && semanticCoverageOk)) {
  advisories.push(
    'This resume was refined after failing QA on semantic coverage ' +
    '(pass-1 required_match_ratio ' + qa.required_match_ratio + ' against a ' +
    SEMANTIC_TARGET + ' target). QA Review does not re-run after a refine, so ' +
    'the refined text was never re-scored. The deterministic checks all pass. ' +
    'Read the summary and bullets yourself before sending this one out.'
  );
}

return {
  resume,
  job_data: prev.job_data,
  fit_verdict: qa.fit_verdict || null,
  thesis: prev.thesis || null,
  houseRules: prev.houseRules || '',
  layout: prev.layout || {},
  coverage: {
    ...prev.coverage,
    semantic_required_ratio: qa.required_match_ratio,
    semantic_target: SEMANTIC_TARGET,
    unmet_required: qa.unmet_required || [],
    visibility_gaps: qa.visibility_gaps || [],
  },
  qa,
  structural_failures,
  structural_ok,
  gate_pass,
  attempt,
  max_attempts: MAX_ATTEMPTS,
  refined_pass: isRefinedPass,
  clean,
  semantic_verified,
  unresolved_failures,
  advisories,
  // pass              - first pass, everything checked and clean
  // needs_refine      - first pass failed, going to Refine Resume
  // refined_ok        - refined output passes every deterministic check,
  //                     semantic score not re-verified
  // shipped_with_warnings - refined output still breaks deterministic rules
  status: clean
    ? (isRefinedPass ? 'refined_ok' : 'pass')
    : (exhausted ? 'shipped_with_warnings' : 'needs_refine'),
};
