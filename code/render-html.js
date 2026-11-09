// ─────────────────────────────────────────────────────────────
// Render HTML — deterministic template. The LLM never touches
// formatting; this node is the only thing that decides layout.
// Contact info is constant: the model cannot typo it.
//
// This node also OWNS two things the LLM has proven unreliable at:
//   1. Engagement ordering (sorted mechanically by end date).
//   2. Page-break discipline (no orphaned headings or lone bullets).
// ─────────────────────────────────────────────────────────────
const CONTACT = {
  name: '[CANDIDATE_NAME]',
  location: '[CANDIDATE_LOCATION]',
  phone: '[CANDIDATE_PHONE]',
  email: '[CANDIDATE_EMAIL]',
  linkedinUrl: '[LINKEDIN_URL]',
  linkedinLabel: '[LINKEDIN_LABEL]',
  githubUrl: '[GITHUB_URL]',
  githubLabel: '[GITHUB_LABEL]',
};

const item = $input.first().json;
/** @type {any} */
const r = item.resume;
if (!r || !r.experience || !r.experience.length) {
  throw new Error('Resume JSON is missing or has no experience entries');
}

// ── helpers ──────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// Model is instructed to emit plain text; defensively convert any
// stray markdown emphasis instead of letting asterisks leak into the PDF.
function inline(s) {
  let t = esc(s);
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/`([^`\n]+)`/g, '$1');
  return t;
}
// Skills are written by an LLM and arrive with inconsistent casing
// ("PostgreSQL" next to "data validation"). Uppercase the first letter of
// each item so the list reads as a deliberate list. Acronyms are untouched
// because only character zero is changed.
function capFirst(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function sanitize(s) {
  if (!s) return 'Unknown';
  return String(s).replace(/[^a-zA-Z0-9\s\-_]/g, '').replace(/\s+/g, '').trim().substring(0, 40);
}

// ── deterministic engagement ordering ────────────────────────
const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
function monthValue(token) {
  const t = String(token || '').trim();
  if (/present|current|ongoing/i.test(t)) return 999999;
  const m = t.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (!m) return -1;
  const mi = MONTHS[m[1].toLowerCase()];
  if (mi === undefined) return -1;
  return Number(m[2]) * 12 + mi;
}
function parseRange(range) {
  const raw = String(range || '');
  const parts = raw.split(/\s*[-–—]\s*|\s+to\s+/i);
  if (parts.length < 2) return { start: monthValue(raw), end: monthValue(raw) };
  return { start: monthValue(parts[0]), end: monthValue(parts[parts.length - 1]) };
}
// Sort by end date descending, then start date descending. Entries with
// unparseable dates keep their original relative position at the end.
function sortEngagements(engagements) {
  const decorated = (engagements || []).map((en, i) => {
    const rg = parseRange(en.dates);
    return { en, i, end: rg.end, start: rg.start, bad: rg.end === -1 || rg.start === -1 };
  });
  decorated.sort((a, b) => {
    if (a.bad !== b.bad) return a.bad ? 1 : -1;
    if (a.bad && b.bad) return a.i - b.i;
    if (b.end !== a.end) return b.end - a.end;
    if (b.start !== a.start) return b.start - a.start;
    return a.i - b.i;
  });
  return decorated.map((d) => d.en);
}

// Normalize a date range for DISPLAY only, so the employer line and the
// engagement lines never show mixed dash styles. A plain hyphen-minus is
// used deliberately: some resume parsers mishandle en and em dashes inside
// date ranges, and the visual difference is negligible.
function formatRange(range) {
  return String(range || '').replace(/\s*[-–—]\s*/g, ' - ').trim();
}

// Industry labels share one line with the client, the role, and the date
// range. A long label wraps and strands a word under the dates, which looks
// broken. Two-part labels like "Financial Services / Consumer Lending
// Marketplace" are the usual cause, so anything over the budget collapses to
// its first segment. The dropped detail is always present in the bullets.
const INDUSTRY_CHAR_BUDGET = 26;
function shortIndustry(industry) {
  const full = String(industry || '').trim().replace(/\s+/g, ' ');
  if (full.length <= INDUSTRY_CHAR_BUDGET) return full;
  const first = full.split('/')[0].trim();
  if (first && first.length <= 34) return first;
  const source = first || full;
  if (source.length <= 34) return source;
  return source.slice(0, 32).replace(/\s+\S*$/, '') || source.slice(0, 32);
}

// Strip a trailing parenthetical from the client name when it merely
// restates the industry, e.g. client "Acme Bank (Retail Banking)"
// alongside industry "Retail Banking" printing the same words twice.
function cleanClient(client, industry) {
  let c = String(client || '').trim();
  const ind = String(industry || '').trim().toLowerCase();
  const m = c.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (m && ind) {
    const insideWords = m[2].toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const overlap = insideWords.filter((w) => ind.includes(w)).length;
    if (insideWords.length && overlap / insideWords.length >= 0.6) c = m[1].trim();
  }
  return c;
}

const jd = item.job_data || {};
const companyName = jd.company_name || '';
const roleTitle = jd.job_title || '';
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
// forceBaseName is set by the edit-and-rerender branch so the regenerated
// PDF/MD overwrite the originals instead of picking up today's date.
const baseName = item.forceBaseName || `[CANDIDATE_FILE_PREFIX]_${sanitize(companyName)}_${sanitize(roleTitle)}_${today}`;
const pdfFileName = baseName + '.pdf';
const mdFileName = baseName + '.md';
const pdfTitle = `${CONTACT.name}${roleTitle ? ' — ' + roleTitle : ''}${companyName ? ' — ' + companyName : ''}`;

// Normalize the resume once so HTML and Markdown emit identical content.
const experience = (r.experience || []).map((emp) => ({
  ...emp,
  engagements: sortEngagements(emp.engagements).map((en) => ({
    ...en,
    client: cleanClient(en.client, en.industry),
    industry: shortIndustry(en.industry),
  })),
}));

// ── HTML body ────────────────────────────────────────────────
const out = [];
out.push(`<h1>${esc(CONTACT.name).toUpperCase()}</h1>`);
out.push(`<p class="contact">${esc(CONTACT.location)} &nbsp;|&nbsp; ${esc(CONTACT.phone)} &nbsp;|&nbsp; ${esc(CONTACT.email)}</p>`);
out.push(`<p class="contact"><a href="${esc(CONTACT.linkedinUrl)}">${esc(CONTACT.linkedinLabel)}</a> &nbsp;|&nbsp; <a href="${esc(CONTACT.githubUrl)}">${esc(CONTACT.githubLabel)}</a></p>`);

out.push('<section class="keep"><h2>Professional Summary</h2>');
out.push(`<p>${inline(r.summary || '')}</p></section>`);

out.push('<section class="keep"><h2>Technical Skills</h2>');
for (const g of r.skills || []) {
  out.push(`<p class="skill"><strong>${inline(g.group)}:</strong> ${inline((g.items || []).map(capFirst).join(', '))}</p>`);
}
out.push('</section>');

out.push('<h2>Professional Experience</h2>');
for (const emp of experience) {
  out.push('<div class="employer">');
  out.push('<div class="entry-head">' +
    `<span class="entry-title">${inline(emp.employer)}${emp.employer_title ? ' — ' + inline(emp.employer_title) : ''}</span>` +
    `<span class="entry-dates">${inline(formatRange(emp.employer_dates))}</span></div>`);
  if (emp.employer_summary) out.push(`<p class="entry-sub">${inline(emp.employer_summary)}</p>`);
  out.push('</div>');
  // An engagement is NOT kept together as one block. Forcing whole blocks to
  // stay on one page is what pushed a five-bullet engagement onto the next
  // page and left inches of dead space behind it, which in turn pushed
  // Education onto a third page. Instead only the heading plus its first two
  // bullets are held together, which is enough to guarantee a heading is never
  // stranded and a page never opens on a lone orphaned bullet. Bullets beyond
  // the second are free to flow across the page boundary, so pages fill.
  const LEAD_BULLETS = 1;
  for (const en of emp.engagements || []) {
    const bullets = en.bullets || [];
    const lead = bullets.slice(0, LEAD_BULLETS);
    const rest = bullets.slice(LEAD_BULLETS);
    out.push('<div class="engagement">');
    out.push('<div class="eng-lead">');
    if (en.client) {
      const roleBit = en.role ? ' — ' + inline(en.role) : '';
      const indBit = en.industry ? '<span class="industry"> | ' + inline(en.industry) + '</span>' : '';
      out.push('<div class="engagement-head">' +
        `<span class="engagement-title">${inline(en.client)}${roleBit}${indBit}</span>` +
        `<span class="entry-dates">${inline(formatRange(en.dates))}</span></div>`);
    }
    if (lead.length) {
      out.push('<ul class="lead">');
      for (const b of lead) out.push(`<li>${inline(b)}</li>`);
      out.push('</ul>');
    }
    out.push('</div>');
    if (rest.length) {
      out.push('<ul class="rest">');
      for (const b of rest) out.push(`<li>${inline(b)}</li>`);
      out.push('</ul>');
    }
    out.push('</div>');
  }
}

if ((r.projects || []).length) {
  out.push('<h2>Projects</h2>');
  for (const p of r.projects) {
    out.push('<div class="engagement">');
    out.push(`<div class="entry-head"><span class="entry-title">${inline(p.name)}</span></div>`);
    if (p.description) out.push(`<p class="entry-sub">${inline(p.description)}</p>`);
    if ((p.bullets || []).length) {
      out.push('<ul>');
      for (const b of p.bullets) out.push(`<li>${inline(b)}</li>`);
      out.push('</ul>');
    }
    out.push('</div>');
  }
}

out.push('<section class="keep"><h2>Education</h2>');
for (const ed of r.education || []) {
  const bits = [inline(ed.credential || ''), inline(ed.location || ''), inline(ed.year || '')].filter(Boolean).join(' &nbsp;|&nbsp; ');
  out.push(`<p class="edu"><strong>${inline(ed.school)}</strong>${bits ? ' — ' + bits : ''}</p>`);
}
out.push('</section>');

const pdfHtmlPayload = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(pdfTitle)}</title>
<style>
  @page { size: letter; margin: 0.65in; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.35; color: #111; margin: 0; }
  h1 { font-size: 19pt; letter-spacing: 1.5px; margin: 0 0 3px 0; }
  h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 1.2px solid #222; padding-bottom: 2px; margin: 12px 0 6px 0; }
  .contact { font-size: 9.5pt; color: #333; margin: 0 0 2px 0; }
  .entry-head { display: flex; justify-content: space-between; align-items: baseline; margin-top: 9px; gap: 8px; }
  .entry-title { font-weight: bold; font-size: 11pt; }
  .entry-dates { font-size: 9.5pt; color: #444; white-space: nowrap; }
  .entry-sub { margin: 1px 0 4px 0; color: #444; font-size: 9.5pt; }
  .engagement-head { display: flex; justify-content: space-between; align-items: baseline; margin: 7px 0 1px 0; gap: 8px; }
  .engagement-title { font-weight: bold; }
  .industry { font-weight: normal; color: #555; font-size: 9.5pt; }
  ul { margin: 2px 0 6px 0; padding-left: 16px; }
  li { margin-bottom: 2.5px; }
  /* The lead bullets and the remainder are two <ul> elements so they can break
     apart, but they must read as a single list. Collapse the seam. */
  ul.lead { margin-bottom: 0; }
  ul.rest { margin-top: 0; }
  p { margin: 2px 0 6px 0; }
  .skill { margin: 1.5px 0; }
  .edu { margin: 3px 0; }
  a { color: #111; text-decoration: none; }
  strong { font-weight: bold; }

  /* ── Page-break discipline ──────────────────────────────────
     The goal is the smallest set of unbreakable units that still prevents
     ugly breaks. Keeping whole engagements together was too coarse: it
     reserved multi-inch blocks, so a page ended early and the overflow
     cascaded into an extra page. The unbreakable unit is now the engagement
     heading plus its first two bullets. Everything else flows. */
  h1, h2 { break-after: avoid-page; page-break-after: avoid; }
  h2 { break-inside: avoid; page-break-inside: avoid; }
  .keep { break-inside: avoid; page-break-inside: avoid; }
  .employer { break-inside: avoid; page-break-inside: avoid; break-after: avoid-page; page-break-after: avoid; }
  .eng-lead { break-inside: avoid; page-break-inside: avoid; }
  .engagement-head, .entry-head { break-after: avoid-page; page-break-after: avoid; break-inside: avoid; page-break-inside: avoid; }
  ul.lead { break-before: avoid-page; page-break-before: avoid; }
  li { break-inside: avoid; page-break-inside: avoid; }
  p, li { orphans: 2; widows: 2; }
</style>
</head>
<body>
${out.join('\n')}
</body>
</html>`;

// ── Markdown twin (for quick review / git diffing) ───────────
// FORMAT IS A CONTRACT: 'Read & Parse Edited Markdown' parses this
// back into resume JSON. Do not change the line shapes below.
const md = [];
md.push(`# ${CONTACT.name}`);
md.push(`${CONTACT.location} | ${CONTACT.phone} | ${CONTACT.email}`);
md.push(`LinkedIn: ${CONTACT.linkedinUrl} | GitHub: ${CONTACT.githubUrl}`, '');
md.push('## Professional Summary', '', r.summary || '', '');
md.push('## Technical Skills', '');
for (const g of r.skills || []) md.push(`- **${g.group}:** ${(g.items || []).map(capFirst).join(', ')}`);
md.push('', '## Professional Experience', '');
for (const emp of experience) {
  md.push(`### ${emp.employer}${emp.employer_title ? ' — ' + emp.employer_title : ''} | ${formatRange(emp.employer_dates)}`);
  if (emp.employer_summary) md.push(emp.employer_summary);
  md.push('');
  for (const en of emp.engagements || []) {
    if (en.client) md.push(`**${en.client}${en.role ? ' — ' + en.role : ''}${en.industry ? ' | ' + en.industry : ''}** | ${formatRange(en.dates)}`, '');
    for (const b of en.bullets || []) md.push(`- ${b}`);
    md.push('');
  }
}
if ((r.projects || []).length) {
  md.push('## Projects', '');
  for (const p of r.projects) {
    md.push(`### ${p.name}`);
    if (p.description) md.push(p.description);
    for (const b of p.bullets || []) md.push(`- ${b}`);
    md.push('');
  }
}
md.push('## Education', '');
for (const ed of r.education || []) {
  md.push(`- **${ed.school}** — ${[ed.credential, ed.location, ed.year].filter(Boolean).join(' | ')}`);
}
const resumeMarkdown = md.join('\n');

return {
  ...item,
  resume: { ...r, experience },
  pdfHtmlPayload,
  resumeMarkdown,
  pdfFileName,
  mdFileName,
  pdfTitle,
  companyName,
  roleTitle,
  trackerMissing: ((item.coverage || {}).missing_required || []).join('; '),
  qaNotes: [ ...(((item.qa || {}).fabrication_flags) || []), ...(((item.qa || {}).issues) || []) ].join(' | '),
  stretchClaims: (((r.ats_notes || {}).stretch_claims) || []).join(' | '),
};
