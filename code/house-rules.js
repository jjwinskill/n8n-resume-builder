// ─────────────────────────────────────────────────────────────
// House Rules — the single source of truth for every rule that
// three different LLM nodes must agree on, plus the candidate-
// specific configuration that used to be hard-coded into all
// three prompts.
//
// Before this node existed, the SOURCE OF TRUTH block and the
// CLIENT IDENTITY AND VENDOR REDACTION block were pasted into
// Resume Generator, QA Review, and Refine Resume. They had already
// drifted: two of them asserted a client industry of
// "Industry / Sub-domain" while the generator's own
// industry rule forbids slashes and caps the field at 26 chars.
//
// Edit rules HERE. All three prompts interpolate
//   {{ $('House Rules').first().json.houseRules }}
// and the deterministic code nodes read CONFIG off this output, so
// a change lands everywhere at once and cannot diverge again.
// ─────────────────────────────────────────────────────────────

const CONFIG = {
  // Strings that must never reach the visible resume. Enforced
  // deterministically in Coverage Check and Coverage Recheck, and
  // re-checked as a safety net in Evaluate Gate.
  redacted_terms: ['[VENDOR_TO_REDACT]'],
  redaction_replacement: 'a third-party vendor platform',

  // Engagements where the Super Resume is ambiguous about who the client
  // actually was, so the model kept promoting an integration target into
  // the client field. Matched on the engagement date range.
  client_overrides: [
    { dates: '[CLIENT_1_DATES]', client: '[CLIENT_1]', industry: '[CLIENT_1_INDUSTRY]' },
  ],

  // Clients that appear on every resume regardless of relevance scoring,
  // because their name recognition is worth more to a reviewer than a
  // marginally better keyword match. Never allowed to displace an
  // engagement that continuity requires. Set to [] to disable.
  always_include_clients: ['[RECOGNIZABLE_CLIENT]'],

  // The employer umbrella. Continuity is measured against this range.
  employer: {
    name: '[EMPLOYER_1]',
    title: '[EMPLOYER_1_TITLE]',
    dates: '[EMPLOYER_1_DATES]',
  },

  // Largest uncovered interval, in months, that may appear between
  // consecutive engagements before a reviewer reads it as unemployment.
  max_gap_months: 4,

  // Trailing gaps get a wider tolerance than interior ones. An interior hole
  // reads as a job loss being concealed; a few months between the most recent
  // engagement and today reads as actively looking, which is already given.
  max_trailing_gap_months: 8,

  education: [
    { school: '[SCHOOL_1]', credential: '[CREDENTIAL_1]', location: '[SCHOOL_1_LOCATION]', year: '[SCHOOL_1_YEAR]' },
    { school: '[SCHOOL_2]', credential: '[CREDENTIAL_2]', location: '[SCHOOL_2_LOCATION]', year: '[SCHOOL_2_YEAR]' },
  ],
};

const overrideLines = CONFIG.client_overrides
  .map((o) => `    - For the ${o.dates} engagement the client is "${o.client}" with industry "${o.industry}".`)
  .join('\n');

const educationLines = CONFIG.education
  .map((e, i) => `  ${i + 1}. school "${e.school}"; credential "${e.credential}"; location "${e.location}"; year "${e.year}"`)
  .join('\n');

const houseRules = `SOURCE OF TRUTH

1. The Super Resume is the sole source of candidate facts.
2. Every claim, technology, methodology, metric, date, responsibility, and qualification in the visible resume must be supported by the Super Resume.
3. The Super Resume's "Baseline Qualifications and Transferable Competencies" section is valid evidence. Do not require a baseline competency to be repeated inside a client engagement before it may be used.
4. Never invent, upgrade, or rename a qualification. Never claim a specific degree field, certification, clearance, authorization, location, technology, or number of years that the Super Resume does not establish.
5. Do not use evasive phrases such as "X-adjacent," "X-style," "similar to X," or "exposure to X."
6. Never upgrade instrumentation work into analysis work. Implementing, configuring, or integrating a tool is not the same as performing the analysis that tool enables. Describe only the work performed.
7. No trajectory, ramp-time, or learning-speed language anywhere. Do not describe moving, ramping, pivoting, transitioning, expanding, or shifting between specializations, do not state how recently or how quickly a capability was acquired, do not apply a self-narrowing label to the candidate, and do not claim learning agility. A resume states completed work.
8. Every metric is a single unambiguous figure. Never combine a range with a plus sign. When the Super Resume gives a range, state the lower bound with no plus sign.
9. No aspirational, eager, hopeful, or intent language anywhere. When evidence for a topic does not exist, omit the topic rather than expressing interest in it.

CLIENT IDENTITY AND VENDOR REDACTION

- Client names are the organizations that engaged the candidate. Use the client name exactly as the Super Resume states it.
- Third-party vendor platforms the candidate merely integrated with or evaluated are not clients and must never occupy the client field. Never replace a real client name with a description of a vendor.
- Where the Super Resume is ambiguous about who the client was, these overrides are authoritative:
${overrideLines}
- These strings must never appear anywhere in the visible resume: ${CONFIG.redacted_terms.map((t) => `"${t}"`).join(', ')}. When describing work that touches these systems, refer to the affected system generically, for example "${CONFIG.redaction_replacement}", without naming it.
- Other vendor names the Super Resume lists as integration targets may be named.

FIXED CANDIDATE FACTS

- Employer umbrella: employer "${CONFIG.employer.name}", employer_title "${CONFIG.employer.title}", employer_dates "${CONFIG.employer.dates}".
- Education, exactly:
${educationLines}
- location_line is exactly "[CANDIDATE_LOCATION]". The renderer prints a fixed contact block, so availability, commute radius, hybrid or remote preferences, county names, and regional qualifiers here are discarded.`;

return {
  ...$json,
  config: CONFIG,
  houseRules,
};
