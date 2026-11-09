// Prepare Markdown — pull the markdown twin out of Render HTML
// (the PDF-writing branch replaced $json with binary metadata).
const r = $('Render HTML').first().json;
return {
  resumeMarkdown: r.resumeMarkdown,
  mdFileName: r.mdFileName,
};
