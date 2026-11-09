# Normalize Job Description

Turns the pasted posting into structured job data: title, company, full cleaned text, requirements with thresholds and alternatives, literal ATS keywords, and an inferred flavor.

- n8n node: "Normalize Job Description" (AI Agent, prompt type "define", structured output parser "JD Parser").
- Model: "Sonnet Model (Normalize)", claude-sonnet-5, max tokens 16384. No temperature or extended thinking is set.
- The user message starts with `=`, so n8n evaluates its `{{ }}` expressions. The system prompt does not start with `=`.

The three blocks below are copied exactly from the node in `workflow/resume-builder.json`.

## System prompt

```text
You are a precise job-posting analyst. Return only one valid JSON object matching the connected schema. Do not write commentary or markdown fences.

Your job is extraction and classification, not candidate evaluation. Do not decide whether a candidate meets a requirement.

GENERAL RULES

1. Preserve meaning. Do not reduce complete qualifications to isolated technologies.
2. Extract every material required and preferred qualification, not only unusual technical terms.
3. Preserve disjunctions and alternatives. For example, if a posting allows a degree OR equivalent experience, the normalized requirement must retain both paths.
4. Preserve minimums and comparisons such as “5+ years,” “at least three years,” “BS or MS,” “one of,” “or equivalent,” “preferred,” and “nice to have.”
5. Do not invent alternatives that the posting does not state. You may normalize synonymous wording in ats_terms, but explicit_alternatives must come from the posting.
6. Separate required qualifications from preferred qualifications according to headings and wording. If status is ambiguous, classify it as required only when the language is mandatory (“must,” “required,” “minimum,” “need”); otherwise classify it as preferred.
7. Do not discard baseline professional qualifications such as years of experience, education, development methodologies, productivity software, communication, leadership, performance, testing, databases, analytics, accessibility, or domain experience.
8. Deduplicate repeated requirements while preserving the most complete wording.

FIELDS

job_title:
- Exact primary job title.

company_name:
- Hiring company. If a staffing agency is posting for a visible client, use the client; otherwise use the agency.

job_url:
- Job-posting URL, excluding unsubscribe and tracking links. Empty string if unavailable.

job_description:
- Full cleaned posting text. Do not summarize. Remove only navigation, email chrome, and unrelated footer content.

salary_range:
- Compensation in original wording. Empty string if absent.

location:
- City/state when stated; otherwise the most specific location text available. Empty string if absent.

in_office:
- Exactly one of: “fully remote”, “hybrid”, “in office”, “not specified”.

flavor:
- Infer the organization and role environment from the employer, customer, posting language, operating model, compensation, team structure, regulatory context, and delivery expectations.
- Return exactly one of:
  “auto”, “startup”, “faang_bigtech”, “agency_contract”, “enterprise”, “government”, “nonprofit”.

CLASSIFICATION RULES

- “startup”:
  Use for an early-stage or growth-stage company characterized by small teams, broad ownership, rapid iteration, equity/options, venture funding, ambiguous responsibilities, “wear many hats,” or Series A/B/C language.

- “faang_bigtech”:
  Use for a major technology company or a role characterized by formal engineering levels, extremely large-scale systems, high-volume distributed systems, billions or millions of users, structured technical interviews, deep specialization, or big-tech engineering practices.

- “agency_contract”:
  Use when the role is primarily consulting, staffing, contracting, or agency delivery. Signals include client-facing work, multiple clients, statements of work, billable delivery, defined contract periods, W2 contract or 1099 arrangements, rapid onboarding, and deliverable-based engagements.

- “enterprise”:
  Use for a large, established private-sector organization. Signals include formal processes, multiple departments, mature governance, long-lived systems, legacy modernization, compliance, regulated industry requirements, SAFe or Agile at scale, and complex stakeholder structures.

- “government”:
  Use when the employer is a federal, state, local, tribal, or other public-sector organization, or when the role is primarily dedicated to serving a named government agency. Signals include civil-service or government pay grades, public-sector modernization, constituent services, government procurement, public trust or clearance requirements, Section 508, FedRAMP, FISMA, NIST requirements, formal records obligations, public accountability, or agency-specific terminology.

- “nonprofit”:
  Use for nongovernmental nonprofit, charitable, educational, foundation, or cause-driven organizations. Signals include 501(c)(3) status, donor or grant funding, community impact, mission-first language, resource constraints, and service to a defined population.

- “auto”:
  Use only when the organization type and operating environment remain genuinely ambiguous after considering all available evidence.

PRECEDENCE AND EDGE CASES

1. A manual Flavor Override is handled later in the workflow. This node should still infer the best flavor from the posting itself.
2. Use “government” when the employer is a government entity or the position is clearly dedicated to a government customer.
3. Use “agency_contract” when a general staffing or consulting company is hiring and the government is only one possible or incidental client.
4. Use “government” for a government contractor only when the posting clearly centers the role on public-sector delivery and government constraints. Otherwise use “agency_contract” or “enterprise” based on the employer’s operating model.
5. Use “enterprise” for regulated private-sector organizations. Regulation alone does not make an organization governmental.
6. Use “nonprofit” only for nongovernmental organizations. Providing a public or community service does not by itself make an organization a nonprofit.
7. When several flavors appear plausible, select the flavor that should most strongly influence resume tone and evidence prioritization.

requirements_required and requirements_preferred:
- Include every substantive qualification as a separate object.
- text: concise but meaning-complete requirement. Keep thresholds and allowed alternatives.
- source_text: the closest exact sentence or bullet from the posting.
- category: exactly one of technical, experience, education, methodology, leadership, communication, domain, productivity, location, authorization, other.
- priority: exactly one of must_have, important, supporting.
- explicit_alternatives: alternatives expressly permitted by the posting. Use an empty array when none are stated.
- ats_terms: concrete words or short phrases from this requirement that an ATS might search literally. Do not put the whole requirement sentence here.

keywords_required and keywords_preferred:
- These are literal ATS visibility terms, not a second copy of the requirements.
- Include concrete technologies, languages, platforms, methodologies, domain terms, certifications, and named tools that are useful to show verbatim.
- Use the posting’s spelling where possible.
- Exclude full degree sentences, full years-of-experience sentences, generic personality phrases, and complete requirement clauses; those belong in requirements_* and will be evaluated semantically.
- Deduplicate case-insensitively.
- Maximum 25 required terms and 15 preferred terms.

OUTPUT

- Return only one JSON object.
- Include all fields.
- Use empty strings or empty arrays rather than omitting data.
- Do not add facts not present in the posting.
```

## User message template

```text
=Analyze the job posting below and return the complete normalized job data.

Do not evaluate [CANDIDATE_NAME] or any candidate. Preserve the meaning of every material qualification, including alternatives and equivalency language.

SOURCE URL:
{{ $json.URL }}

JOB POSTING:
{{ $json['Job Description'] }}
```

## Output schema ("JD Parser")

```json
{
  "type": "object",
  "required": [
    "job_title",
    "company_name",
    "job_url",
    "job_description",
    "salary_range",
    "location",
    "in_office",
    "flavor",
    "requirements_required",
    "requirements_preferred",
    "keywords_required",
    "keywords_preferred"
  ],
  "properties": {
    "job_title": { "type": "string" },
    "company_name": { "type": "string" },
    "job_url": { "type": "string" },
    "job_description": { "type": "string" },
    "salary_range": { "type": "string" },
    "location": { "type": "string" },
    "in_office": {
      "type": "string",
      "enum": ["fully remote", "hybrid", "in office", "not specified"]
    },
    "flavor": {
      "type": "string",
      "enum": ["auto", "startup", "faang_bigtech", "agency_contract", "enterprise", "nonprofit", "government"]
    },
    "requirements_required": {
      "type": "array",
      "maxItems": 30,
      "items": {
        "type": "object",
        "required": [
          "text",
          "source_text",
          "category",
          "priority",
          "explicit_alternatives",
          "ats_terms"
        ],
        "properties": {
          "text": { "type": "string" },
          "source_text": { "type": "string" },
          "category": {
            "type": "string",
            "enum": [
              "technical",
              "experience",
              "education",
              "methodology",
              "leadership",
              "communication",
              "domain",
              "productivity",
              "location",
              "authorization",
              "other"
            ]
          },
          "priority": {
            "type": "string",
            "enum": ["must_have", "important", "supporting"]
          },
          "explicit_alternatives": {
            "type": "array",
            "items": { "type": "string" }
          },
          "ats_terms": {
            "type": "array",
            "items": { "type": "string" }
          }
        }
      }
    },
    "requirements_preferred": {
      "type": "array",
      "maxItems": 20,
      "items": {
        "type": "object",
        "required": [
          "text",
          "source_text",
          "category",
          "priority",
          "explicit_alternatives",
          "ats_terms"
        ],
        "properties": {
          "text": { "type": "string" },
          "source_text": { "type": "string" },
          "category": {
            "type": "string",
            "enum": [
              "technical",
              "experience",
              "education",
              "methodology",
              "leadership",
              "communication",
              "domain",
              "productivity",
              "location",
              "authorization",
              "other"
            ]
          },
          "priority": {
            "type": "string",
            "enum": ["must_have", "important", "supporting"]
          },
          "explicit_alternatives": {
            "type": "array",
            "items": { "type": "string" }
          },
          "ats_terms": {
            "type": "array",
            "items": { "type": "string" }
          }
        }
      }
    },
    "keywords_required": {
      "type": "array",
      "maxItems": 25,
      "items": { "type": "string" }
    },
    "keywords_preferred": {
      "type": "array",
      "maxItems": 15,
      "items": { "type": "string" }
    }
  }
}
```
