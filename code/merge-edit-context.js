// ─────────────────────────────────────────────────────────────
// Merge Edit Context — joins the parsed resume with the matching
// tracker row (looked up by pdf_path). No duplicate check runs on
// this branch: we're updating an existing application, not adding.
// ─────────────────────────────────────────────────────────────
const parsed = $('Read & Parse Edited Markdown').first().json;
const first = $input.first();
const row = (first && first.json) || {};
const row_found = Boolean(row && row.pdf_path);

return {
  resume: parsed.resume,
  forceBaseName: parsed.baseName,
  status: 'edited',
  row_found,
  job_data: {
    company_name: row.company || '',
    job_title: row.role || '',
    job_url: row.job_url || '',
    location: row.location || '',
    salary_range: row.salary_range || '',
  },
};
