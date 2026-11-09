// Attach the Job Thesis to the pipeline payload.
// The agent node replaces the item with just its own output, so the upstream
// context (job_data, superResumeText, config, houseRules) has to be re-joined.
const base = $('House Rules').first().json;
const thesis = $json.output ?? $json.thesis ?? null;

return [{ json: { ...base, thesis } }];
