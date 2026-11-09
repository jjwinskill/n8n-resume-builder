// Prepare Markdown (Edited) — pull the normalized markdown twin out of
// Render HTML (Edited) so the on-disk .md always matches the shipped PDF.
const r = $('Render HTML (Edited)').first().json;
return {
  resumeMarkdown: r.resumeMarkdown,
  mdFileName: r.mdFileName,
};
