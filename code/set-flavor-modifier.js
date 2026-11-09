// ─────────────────────────────────────────────────────────────
// Set Flavor Modifier — merges super-resume text, normalized job
// data, and the flavor (form override wins over inferred flavor).
// ─────────────────────────────────────────────────────────────
const flavorMap = {
  auto:            'Infer the appropriate tone from the job description context. Use your judgment about which bullet types and emphasis serve this particular role best.',
  startup:         'Emphasize speed of delivery, ownership of full systems, breadth of impact, and startup-relevant wins. Prefer impact-focused and leadership/scope bullets from the Super Resume. Tone should be direct and outcomes-driven. Highlight roles where the candidate absorbed multiple functions.',
  faang_bigtech:   'Emphasize scale, systems thinking, cross-functional collaboration, and measurable impact metrics. Prefer technical depth and ATS/keyword-focused bullets. Use the STAR framework implicitly within bullets (situation implied, action explicit, result quantified). Demonstrate engineering rigor and documentation habits.',
  agency_contract: 'Emphasize client-facing delivery, adaptability across stacks and industries, and multi-client breadth. All three bullet types are relevant. Highlight contract and consulting experience prominently. Show velocity and the ability to onboard quickly to unfamiliar codebases.',
  enterprise:      'Emphasize process maturity, stakeholder communication, security and compliance awareness, and long-term system thinking. Tone is more formal. Highlight contributions to large-scale systems, team coordination, and cross-departmental initiatives.',
  nonprofit:       'Emphasize mission alignment, resource efficiency under constraints, and community or human impact. Tone is collaborative rather than competitive. Highlight work that demonstrates resourcefulness and impact per dollar or per hour.',
  government: [
  'Prioritize evidence of public-serving systems, records integrity, controlled',
  'access to sensitive data, accessibility, documentation discipline, long-lived',
  'system maintenance, and legacy modernization.',
  '',
  'Reframe existing engagements toward the public-sector analogue of the work',
  'performed: describe regulated-data handling as records and privacy',
  'stewardship, describe non-technical staff empowerment as service delivery to',
  'internal program staff, and describe document processing pipelines as',
  'high-volume intake and validation of official records.',
  '',
  'Where the posting names a domain such as courts, records, permitting, or',
  'benefits, surface the candidate engagement operating in the closest',
  'analogous domain and place it prominently through bullet emphasis, never by',
  'breaking chronological order.',
  '',
  'Emphasize reliability, incident response, auditability, and documentation',
  'over velocity, growth, and scale.',
  '',
  'Never state or imply prior government employment, security clearance, public',
  'trust status, or agency-specific certification unless the Super Resume',
  'establishes it. Never substitute enthusiasm for absent public-sector',
  'experience. Omit the topic rather than expressing interest in it.',
].join('\n'),
};

const superResumeText = String($json.superResumeText || '');
if (superResumeText.length < 1000) {
  throw new Error('Super resume text is missing or suspiciously short — verify /data/super-resume.md exists in the mounted volume');
}

const job_data = $('Check for duplicates').first().json.job_data;
const formOverride = String($('On form submission').first().json['Flavor Override'] || 'auto').trim();
const flavor = formOverride && formOverride !== 'auto' ? formOverride : (job_data.flavor || 'auto');

return {
  job_data,
  superResumeText,
  flavor,
  flavor_instruction: flavorMap[flavor] || flavorMap.auto,
};
