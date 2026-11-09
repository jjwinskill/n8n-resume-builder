// ─────────────────────────────────────────────────────────────
// Check for duplicates — compares the normalized job against
// every row already in the "applications" Data Table.
// Match rule: same job URL (normalized), OR same company + role.
// ─────────────────────────────────────────────────────────────
const job = $('Normalize Job Description').first().json.output;
if (!job || !job.job_title) {
  throw new Error('Normalized job data is missing — check the Normalize Job Description node output');
}

const norm = (s) => String(s || '').trim().toLowerCase();
const urlOf = (s) => norm(s).replace(/[?#].*$/, '').replace(/\/+$/, '');

const rows = $input.all()
  .map((i) => i.json)
  .filter((r) => r && (r.job_url || r.company || r.role));

const jobUrl = urlOf(job.job_url);
let duplicate_match = '';
for (const r of rows) {
  if (jobUrl && urlOf(r.job_url) === jobUrl) {
    duplicate_match = `same URL as "${r.company} — ${r.role}" (${r.created_at || 'date unknown'})`;
    break;
  }
  if (norm(r.company) === norm(job.company_name) && norm(r.role) === norm(job.job_title)) {
    duplicate_match = `same company + role: "${r.company} — ${r.role}" (${r.created_at || 'date unknown'})`;
    break;
  }
}

return {
  job_data: job,
  is_duplicate: Boolean(duplicate_match),
  duplicate_match,
  tracked_count: rows.length,
};
