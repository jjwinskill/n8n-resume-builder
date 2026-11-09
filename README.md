# n8n Resume Builder

An n8n workflow that turns a job posting into a two-page resume PDF written for that job. It makes five Claude calls, checks the result with deterministic code, and prints it through a fixed HTML template with Gotenberg. Every fact on the resume has to come from one source document that the candidate writes and keeps up to date.

I built it for my own job search in 2026. It is now retired and replaced by [job-search](https://github.com/jjwinskill/job-search), a Claude Code plugin. This repo is the final version of the workflow, published as it was, with personal details replaced by placeholders.

## In two minutes

- **What it does.** You paste a job posting into a form. A PDF and a markdown copy of the resume land in a folder, and a tracker row records how well the resume covers the posting and what it could not honestly claim.
- **Truthfulness is the design goal.** The model classifies every requirement as direct, equivalent, partial or unmatched against the source document. Unmatched requirements produce no visible text at all, not even a softened synonym. Partial and unmatched items go into a "stretch claims" list for the candidate to read before sending.
- **A second model call audits the first.** The QA step re-checks every requirement, flags anything it cannot trace to the source document, and sorts 25 rejection criteria into blocking and advisory.
- **Code enforces what prompts cannot.** Eighteen structural checks run in a Code node: date formats and ranges, summary length, banned phrases such as "passionate about", hedged skills such as "X-adjacent", gaps in the timeline, and the page budget. Names that must never appear are scrubbed in code, not just forbidden in a prompt.
- **The model writes content, never layout.** It returns JSON. A fixed template owns the layout, sorts the engagements by date and controls page breaks. Length is budgeted in rendered lines, computed from the template's own CSS.
- **A human stays in the loop.** Every resume also ships as markdown. Edit it, upload it to the second form, and the PDF is re-rendered through the same template with no model call.
- **Size.** 55 nodes: 2 form triggers, 5 AI Agent nodes with JSON schemas, 13 Code nodes, an n8n Data Table as the tracker, and Gotenberg for PDF output.

## How it works

```
Job Post Form (URL, pasted job description, optional flavor)
  -> Normalize Job Description           LLM: posting -> structured job data
  -> Get tracked applications -> Check for duplicates -> IF New Application
        duplicate -> Stop and Error
  -> Read super-resume.md -> Set Flavor Modifier -> House Rules
  -> Job Thesis                          LLM: what the resume has to argue
  -> Merge Thesis
  -> Resume Generator                    LLM: resume as JSON
  -> Coverage Check                      code: redaction, keywords, length
  -> QA Review                           LLM: independent audit
  -> Evaluate Gate                       code: QA verdict + 18 checks
  -> IF Passed QA
        yes -> Render HTML
        no  -> Refine Resume (LLM) -> Coverage Recheck -> Evaluate Gate (final) -> Render HTML
  -> Render HTML -> Gotenberg (HTML to PDF) -> write .pdf and .md
  -> Record Application                  Data Table row

Edit & Re-render Form (upload the edited .md)
  -> Read & Parse Edited Markdown -> Find Tracker Row -> Merge Edit Context
  -> Render HTML (Edited) -> Gotenberg -> overwrite .pdf and .md -> Update Tracker Row
```

Step by step:

1. **Job Post Form.** Fields: the posting URL, the job description text, and a flavor override (auto, startup, faang_bigtech, agency_contract, enterprise, nonprofit, government). The URL is passed along as text and never fetched, so paste the description.
2. **Normalize Job Description** (LLM). Returns title, company, the full cleaned posting, salary, location, work arrangement, an inferred flavor, required and preferred requirements (each with its source sentence, category, priority, allowed alternatives and ATS terms), and literal ATS keywords. It extracts and classifies; it never judges the candidate.
3. **Duplicate check.** Compares the job against every tracker row by normalized URL, or by company and role. A match stops the run.
4. **Read the source document.** Reads `/data/super-resume.md` whole. The run stops if it is missing or under 1,000 characters.
5. **Set Flavor Modifier.** Picks a tone paragraph for the generator. The form override wins over the inferred flavor. Flavor changes emphasis only, never structure or rules.
6. **House Rules** (code). One place for the rules all three writing and auditing prompts share, and for the candidate's fixed facts: the employer, education, names to redact, client overrides and gap tolerances. The code nodes read the same config, so prompts and checks cannot drift apart.
7. **Job Thesis** (LLM). Reads the full posting, not just the requirements list, and decides strategy: what the team builds, which surfaces it owns, which of the candidate's past systems is the closest structural match, what to lead with, and which objection a hiring manager will raise plus the evidence that answers it. It chooses emphasis, never facts.
8. **Resume Generator** (LLM). Writes the resume as JSON: summary, skills, one umbrella employer with nested client engagements, optional projects, education, and ATS notes. Rules include: continuity before relevance (no uncovered gap over 4 months), unequal bullets by relevance (5, 4, then 3 or fewer), a summary of exactly 3 sentences and 55 to 75 words, at most 7 skill groups of 8 items, and a budget of 94 rendered lines with a ceiling of 98, which is two pages.
9. **Coverage Check** (code). Replaces any redacted name. Measures literal keyword coverage (reported, not gating). Estimates rendered lines from the template's CSS and names the bullets whose last line is nearly empty, since those are the cheapest lines to cut.
10. **QA Review** (LLM). An independent, skeptical audit. It reassesses every required requirement, lists fabrication flags (any flag fails the resume), applies 25 numbered criteria marked BLOCKING or ADVISORY, and returns a fit verdict: strong, viable, stretch or poor. Passing needs at least 70% of required requirements matched directly or by an allowed equivalent.
11. **Evaluate Gate** (code). Combines the QA verdict, the match ratio and 18 structural checks. Each failure becomes a plain sentence the refiner can act on.
12. **Refine Resume** (LLM) and **Coverage Recheck**. Makes the smallest set of edits that fixes the failures. There is exactly one refine pass. The second gate pass always ships the resume and records any remaining problems as warnings.
13. **Render HTML** (code). The template. Single column, US Letter, 0.65 inch margins, Arial 10.5pt. The contact block is constant, so the model cannot get it wrong. It also writes the markdown copy, whose line shapes are the contract for the edit branch.
14. **Gotenberg.** Converts the HTML to PDF with headless Chromium and the CSS page size. Inside the Gotenberg container Arial resolves to Liberation Sans, which has the same metrics, so the line estimate still holds. Files are written to `/data/resumes/` as `<prefix>_<Company>_<Role>_<YYYYMMDD>.pdf` and `.md`.
15. **Record Application.** Appends a tracker row: company, role, URL, location, salary, flavor, status, literal keyword coverage, missing keywords, QA notes, stretch claims and the PDF path.

Status values: `pass`, `needs_refine`, `refined_ok`, `shipped_with_warnings`, and `edited` from the edit branch.

Models as exported: `claude-sonnet-5` on four nodes and `claude-sonnet-4-6` on Refine Resume. No temperature or extended thinking is set. Four of the five agent nodes make up to three attempts when a call fails.

## Repository layout

| Path | What it is |
|---|---|
| `workflow/resume-builder.json` | The workflow export, with credentials, owner details, webhook IDs and the original workflow ID removed. Import this. |
| `prompts/` | The five LLM prompts: system prompt, user message template and output schema, copied exactly from the workflow. |
| `code/` | The Code nodes, copied exactly from the workflow. `render-html.js` is the resume template and is used by both Render HTML and Render HTML (Edited). |
| `docker-compose.yml` | n8n in queue mode (app and worker), Postgres, Redis and Gotenberg. |
| `.env.example` | Environment variables with placeholder values. |
| `resume-data/` | Mounted at `/data`. Your `super-resume.md` goes here and resumes are written to `resume-data/resumes/`. Ignored by git. |

## Running it

You need Docker and an Anthropic API key.

1. **Configure.** `cp .env.example .env`, then set `POSTGRES_PASSWORD` and `N8N_ENCRYPTION_KEY` (generate one with `openssl rand -hex 32`). Set the timezone to yours.
2. **Write the source document** at `resume-data/super-resume.md`. See the format below.
3. **Fill the placeholders** in `workflow/resume-builder.json` before you import it. A find-and-replace on each placeholder in the table below is the quickest way. Or import first and edit the nodes in n8n, which is easier for any value that contains an apostrophe, since most placeholders sit inside JavaScript strings.
4. **Start the stack.** `docker compose up -d`, open http://localhost:5678 and create the owner account.
5. **Import the workflow.** In the editor, use Import from File on `workflow/resume-builder.json`. Or from the command line:
   ```
   docker compose cp workflow/resume-builder.json n8n:/tmp/resume-builder.json
   docker compose exec n8n n8n import:workflow --input=/tmp/resume-builder.json
   ```
6. **Attach the credential.** Create an Anthropic credential and select it on the five model nodes: Sonnet Model (Normalize), Sonnet Model (Thesis), Sonnet Model (Generate), Sonnet Model (QA) and Sonnet Model (Refine). No other node needs a credential. Gotenberg is reached on the internal Docker network with no auth.
7. **Create the tracker.** Create an n8n Data Table named `applications` with these columns: `company`, `role`, `job_url`, `location`, `salary_range`, `flavor`, `status`, `missing_keywords`, `qa_notes`, `stretch_claims`, `pdf_path` (string) and `coverage_required` (number). Then select it in all four Data Table nodes: Get tracked applications, Record Application, Find Tracker Row and Update Tracker Row.
8. **Run it.** The workflow is saved inactive. Open the On form submission node, use its test URL, and paste a posting. The PDF and markdown appear in `resume-data/resumes/`.
9. **To edit a resume,** change the wording in its `.md` file, keep the file name and the structure lines, and upload it through the Edit & Re-render Form.

If a model name is no longer available, change it on the model nodes.

### Placeholders

| Placeholder | Stands for | Where |
|---|---|---|
| `[CANDIDATE_NAME]` | Full name | Render HTML (both copies), both Gotenberg nodes (PDF author), prompts for Normalize, Generator and Refine |
| `[CANDIDATE_FILE_PREFIX]` | Name with no spaces, used in output file names | Render HTML (both copies) |
| `[CANDIDATE_LOCATION]` | City and state printed in the header | Render HTML (both copies), House Rules |
| `[CANDIDATE_PHONE]`, `[CANDIDATE_EMAIL]` | Contact details printed in the header | Render HTML (both copies) |
| `[LINKEDIN_URL]`, `[LINKEDIN_LABEL]` | Profile link and its visible text | Render HTML (both copies) |
| `[GITHUB_URL]`, `[GITHUB_LABEL]` | Profile link and its visible text | Render HTML (both copies) |
| `[EMPLOYER_1]`, `[EMPLOYER_1_TITLE]`, `[EMPLOYER_1_DATES]` | The umbrella employer, your title there, and its range as `Mon YYYY - Mon YYYY` | House Rules |
| `[EMPLOYER_1_LOCATION]` | The employer's city, used in the one-line employer summary | Resume Generator prompt |
| `[CLIENT_1]`, `[CLIENT_1_DATES]`, `[CLIENT_1_INDUSTRY]` | An override for an engagement whose client the source document leaves ambiguous. Delete the entry if you have none. | House Rules |
| `[RECOGNIZABLE_CLIENT]` | A client to show on every resume for name recognition. Use `[]` to turn this off. | House Rules |
| `[VENDOR_TO_REDACT]` | A name that must never appear on a resume. Use `[]` if you have none. | House Rules |
| `[SCHOOL_1]`, `[CREDENTIAL_1]`, `[SCHOOL_1_LOCATION]`, `[SCHOOL_1_YEAR]` | First education entry. Replace a placeholder with nothing to leave that field blank. | House Rules; school and credential also in the QA Review prompt |
| `[SCHOOL_2]`, `[CREDENTIAL_2]`, `[SCHOOL_2_LOCATION]`, `[SCHOOL_2_YEAR]` | Second education entry | Same as above |

The workflow assumes one umbrella employer, such as an agency or consultancy, with client engagements nested under it. A history with several direct employers needs changes to the generator's STRUCTURE section, the employer block in House Rules and the QA structure check.

### The source document

`resume-data/super-resume.md` is a markdown file holding everything true about the candidate, far more than any one resume shows. The whole file goes into four of the five model calls, so its length drives cost. The prompts treat it as the only source of facts and rely on a few conventions:

- A section named `## Baseline Qualifications and Transferable Competencies`. House rule 3 says it counts as evidence on its own, so general skills there do not need repeating inside an engagement.
- One `###` header per engagement with the client, the role actually held and the dates. The generator copies the role and dates from this header, and QA checks them against it.
- Concrete bullets with real numbers under each engagement. The model can only use a metric that is written here.
- Projects, a skills inventory and education, if you have them.

Contact details are not read from this file. The template prints its own.

```markdown
# Super Resume

## Candidate Info
[CANDIDATE_NAME], [CANDIDATE_LOCATION]

## Baseline Qualifications and Transferable Competencies
- Languages, practices and tools you can back up, with years where they matter.

## [EMPLOYER_1]
[EMPLOYER_1_TITLE], [EMPLOYER_1_DATES]

### Example Client (via [EMPLOYER_1]) | Senior Software Engineer | Mar 2021 - Oct 2023
- What you built, the constraint it answered, and the measurable result.
- Every technology you used there, named plainly.

## Projects
## Skills Inventory
## Education
```

## What it taught me

- **A prompt is a request, not a guarantee.** The rule against naming a certain vendor lived in three prompts and still broke about one run in four. Anything that can be checked mechanically moved into code: redaction, banned phrases, counts, dates and gaps.
- **Budget in the unit the renderer bills.** Length was first budgeted in words, and five runs in a row trimmed words from every bullet and still printed three pages. A bullet costs whole lines. Estimating lines from the template's CSS fixed it.
- **Caps are poor proxies.** A five-engagement cap, added to keep resumes to two pages, deleted engagements and left a multi-year hole in a continuous work history. A reviewer reads a gap as unemployment. Continuity now outranks relevance, and the line budget is the only length control.
- **Keep the model away from layout.** Moving from model-written markdown to JSON plus a fixed template ended leaked code fences, metadata blocks and literal asterisks in the PDFs. Ordering was also moved into code after the model kept getting it wrong.
- **n8n only evaluates `{{ }}` in a field that starts with `=`.** The three system prompts that pull in the shared House Rules do not start with `=`, so the rules most likely reached the model as literal braces. The output showed the symptoms: the fixed employer title and education varied from run to run. Check the prompt the model actually receives, not the template.
- **A leftover can switch off a whole branch.** The IF Passed QA condition was hard-wired to `true`, so Refine Resume never ran and every resume shipped as first drafted. When nothing blocks, the failure mode is silent shipping.
- **Self-review has limits.** The auditor is the same model family as the writer, and the refined resume is never audited again. Deterministic checks catch structure, not truth.
- **Give the model the date.** No model call was told today's date, so QA sometimes flagged past end dates as future ones.

## Known issues, as retired

- **IF Passed QA is always true,** so Refine Resume is unreachable. Earlier versions used `{{ $json.gate_pass }}`.
- **House Rules probably never reach three prompts.** The system prompts of Resume Generator, QA Review and Refine Resume would need a leading `=`.
- **The trailing-gap check has a clock in it.** Evaluate Gate fails any resume whose latest engagement ended more than 8 months ago, unless the source document covers the time since.
- **The edit branch** resets `coverage_required` to 0, does not check that a tracker row was found, and prints the template's fixed contact block whatever the markdown says. It runs no QA.
- **File names use the UTC date,** so an evening run can be named for the next day. The company and role parts lose their spaces and are cut at 40 characters, and two runs for the same job on one day overwrite each other.
- **The tracker read** uses the Data Table node's default row limit, and `created_at` is never written.
- **Two sticky notes are stale.** Tuning Knobs describes an older gate and model setup, and Setup Checklist names only some of the model and Data Table nodes. This README is current.

## Why it was retired

The replacement, [job-search](https://github.com/jjwinskill/job-search), runs as Claude Code skills. That gives current models, sub-agents and web fetching, and there is nothing to host. This workflow stays here as a record of the design.

## License

MIT. See [LICENSE](LICENSE).
