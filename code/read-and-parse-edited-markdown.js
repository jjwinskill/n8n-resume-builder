// ─────────────────────────────────────────────────────────────
// Read & Parse Edited Markdown — reads the uploaded .md file and
// parses OUR markdown format back into the resume structure the
// renderer expects. Deterministic, no LLM. Throws with a clear
// message if the structure was broken during editing.
//
// Editable freely: every sentence, bullet, skill item, date text.
// Must be preserved: '## Section' headers, '### Employer — Title | Dates'
// lines, '**Client — Role | Industry** | Dates' lines, '- ' bullet prefixes,
// '- **Group:** items' skill lines, '- **School** — cred | loc | year'.
// ─────────────────────────────────────────────────────────────
const item = $input.first();
const binKeys = Object.keys(item.binary || {});
if (!binKeys.length) {
  throw new Error('No file uploaded — attach the edited .md file in the form');
}
const key = binKeys[0];
const meta = item.binary[key];
const uploadedName = meta.fileName || '';
if (!/\.md$/i.test(uploadedName)) {
  throw new Error(`Expected a .md file, got "${uploadedName}"`);
}
const baseName = uploadedName.replace(/\.md$/i, '');
const buf = await this.helpers.getBinaryDataBuffer(0, key);
const mdText = buf.toString('utf8');
if (mdText.length < 200) {
  throw new Error('Uploaded markdown is suspiciously short — wrong file?');
}

// ── parse ─────────────────────────────────────────────────────
const lines = mdText.replace(/\r\n/g, '\n').split('\n');

// location line: first non-empty line after '# Name', text before first ' | '
let location_line = '';
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('# ')) {
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t) { location_line = t.split(' | ')[0].trim(); break; }
    }
    break;
  }
}

// split into '## ' sections
const sections = {};
let current = null;
for (const line of lines) {
  if (line.startsWith('## ')) {
    current = line.slice(3).trim().toLowerCase();
    sections[current] = [];
  } else if (current) {
    sections[current].push(line);
  }
}
function req(name, display) {
  if (!sections[name]) throw new Error(`Missing "## ${display}" section header — it must be kept verbatim`);
  return sections[name];
}

const summary = req('professional summary', 'Professional Summary').map((l) => l.trim()).filter(Boolean).join(' ');
if (!summary) throw new Error('Professional Summary section is empty');

const skills = [];
for (const raw of req('technical skills', 'Technical Skills')) {
  const m = raw.trim().match(/^-\s+\*\*(.+?):\*\*\s*(.*)$/);
  if (m) skills.push({ group: m[1].trim(), items: m[2].split(',').map((s) => s.trim()).filter(Boolean) });
}
if (!skills.length) throw new Error('No skill lines parsed — expected lines like "- **Group:** item, item"');

const experience = [];
let emp = null;
let eng = null;
for (const raw of req('professional experience', 'Professional Experience')) {
  const l = raw.trim();
  if (!l) continue;
  if (l.startsWith('### ')) {
    const body = l.slice(4);
    const pipe = body.lastIndexOf(' | ');
    const left = pipe >= 0 ? body.slice(0, pipe) : body;
    const dates = pipe >= 0 ? body.slice(pipe + 3).trim() : '';
    const dash = left.indexOf(' — ');
    emp = {
      employer: (dash >= 0 ? left.slice(0, dash) : left).trim(),
      employer_title: dash >= 0 ? left.slice(dash + 3).trim() : '',
      employer_dates: dates,
      employer_summary: '',
      engagements: [],
    };
    experience.push(emp);
    eng = null;
  } else if (/^\*\*.+\*\*(\s*\|.*)?$/.test(l)) {
    if (!emp) throw new Error(`Engagement line found before any "### Employer" header: "${l}"`);
    const m = l.match(/^\*\*(.+?)\*\*\s*(?:\|\s*(.*))?$/);
    const inner = m[1];
    const dash = inner.indexOf(' — ');
    const client = (dash >= 0 ? inner.slice(0, dash) : inner).trim();
    // After the em dash: "Role | Industry" in the current format, or a bare
    // industry in older exports. A pipe is the only reliable discriminator.
    const tail = dash >= 0 ? inner.slice(dash + 3).trim() : '';
    let role = '';
    let industry = '';
    if (tail.includes(' | ')) {
      const bar = tail.indexOf(' | ');
      role = tail.slice(0, bar).trim();
      industry = tail.slice(bar + 3).trim();
    } else {
      industry = tail;
    }
    eng = {
      client,
      role,
      industry,
      dates: (m[2] || '').trim(),
      bullets: [],
    };
    emp.engagements.push(eng);
  } else if (l.startsWith('- ')) {
    if (!emp) throw new Error(`Bullet found before any "### Employer" header: "${l}"`);
    if (!eng) { eng = { client: '', role: '', industry: '', dates: '', bullets: [] }; emp.engagements.push(eng); }
    eng.bullets.push(l.slice(2).trim());
  } else if (emp && !emp.engagements.length && !emp.employer_summary) {
    emp.employer_summary = l;
  } else if (eng && eng.bullets.length) {
    // hard-wrapped continuation of the previous bullet
    eng.bullets[eng.bullets.length - 1] += ' ' + l;
  }
}
if (!experience.length) throw new Error('No experience entries parsed — expected "### Employer — Title | Dates" headers');

const projects = [];
if (sections['projects']) {
  let p = null;
  for (const raw of sections['projects']) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('### ')) { p = { name: l.slice(4).trim(), description: '', bullets: [] }; projects.push(p); }
    else if (l.startsWith('- ')) { if (p) p.bullets.push(l.slice(2).trim()); }
    else if (p && !p.bullets.length && !p.description) { p.description = l; }
  }
}

const education = [];
for (const raw of req('education', 'Education')) {
  const m = raw.trim().match(/^-\s+\*\*(.+?)\*\*\s*—\s*(.*)$/);
  if (m) {
    const parts = m[2].split(' | ').map((s) => s.trim());
    education.push({ school: m[1].trim(), credential: parts[0] || '', location: parts[1] || '', year: parts[2] || '' });
  }
}
if (!education.length) throw new Error('No education entries parsed — expected lines like "- **School** — credential | location | year"');

return {
  resume: { summary, location_line, skills, experience, projects, education, ats_notes: { matched_keywords: [], stretch_claims: [], requirement_alignment: [], recognition_selections: [] } },
  baseName,
  pdfFileName: baseName + '.pdf',
  mdFileName: baseName + '.md',
  status: 'edited',
};
