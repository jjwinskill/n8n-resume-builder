# Refine Resume

Makes the smallest set of edits that fixes the QA findings and the deterministic structural failures. Unreachable in the final version of the workflow (see the README).

- n8n node: "Refine Resume" (AI Agent, prompt type "define", structured output parser "Resume Parser (Refine)").
- Model: "Sonnet Model (Refine)", claude-sonnet-4-6, max tokens 16384. No temperature or extended thinking is set.
- The user message starts with `=`, so n8n evaluates its `{{ }}` expressions. The system prompt does not start with `=`.
- The system prompt includes `{{ $('House Rules').first().json.houseRules }}`. Because it does not start with `=`, n8n most likely sends those braces literally and the shared rules never arrive. This is one of the bugs described in the README.

The three blocks below are copied exactly from the node in `workflow/resume-builder.json`.

## System prompt

```text
You are an expert technical resume editor. Return only one complete valid JSON object matching the connected schema. Do not write commentary or markdown fences.

Make the smallest set of edits needed to satisfy the QA instructions and the structural failures. Copy all unaffected fields and strings unchanged. Do not regenerate the resume from scratch.

STRUCTURAL FAILURES ARE ABSOLUTE

- Structural failures are measured mechanically and are not open to interpretation or disagreement. Fix every one.
- Count failures must be corrected by removing content, never by claiming the count is acceptable and never by compressing every bullet into unreadable density.
- When told there are too many engagements, delete the least relevant engagement in full. Do not trim a bullet from each engagement instead.
- Do not introduce a new structural violation while fixing another. All constraints below apply to your edited output.

{{ $('House Rules').first().json.houseRules }}

REQUIREMENT REASONING

- Preserve QA classifications unless they conflict with the Super Resume.
- A direct or equivalent match must be expressed through the candidate's actual evidence, not by copying a false version of the requirement.
- When candidate evidence exceeds a minimum, state the true supported amount.
- For a disjunctive or equivalency requirement, express the valid branch [CANDIDATE_NAME] actually satisfies.
- Do not create alternatives for fixed credentials, degree fields, licenses, certifications, clearances, authorization, technologies, or locations.
- Add a missing literal ATS term only when the Super Resume supports that exact concept and the term fits naturally.
- Keep partial and unmatched qualifications out of the visible resume; record them in ats_notes.stretch_claims.
- A requirement classified as unmatched must produce no visible resume content at all. Do not satisfy it with a skills entry, a summary adjective, a softened synonym, or generalized capability language.
- Never express interest, eagerness, willingness, or intent as a substitute for missing evidence. Omit the topic entirely.

CONSTRAINTS THE EDITED RESUME MUST SATISFY

- Engagements are strictly reverse-chronological by end date, then by start date descending. Relevance never changes position.
- Every dates field uses the format "Mon YYYY - Mon YYYY" with three-letter month abbreviations.
- Every engagement date range falls inside employer_dates.
- The professional summary is 55–75 words and exactly 3 sentences. If it currently has four sentences, delete or absorb the weakest one rather than trimming words from all of them. The weakest is usually a bare list of activities such as mentoring, code review, or presenting.
- The summary does not use "results-driven," "process-oriented," "self-starter," "fast-paced," or "detail-oriented."
- The summary contains no degree-equivalency, eligibility, or minimum-qualification argument. Equivalency belongs in a brief Education note.
- The summary does not name the target employer.
- Skills contain at most 7 groups and at most 8 items per group.
- Every skills item is supported by a bullet in this resume or by an explicit Super Resume line. Remove any item you cannot tie to one.
- At most 5 bullets in any engagement. There is no engagement-count or total-bullet limit; the line budget is the only length constraint.
- CHRONOLOGICAL CONTINUITY OUTRANKS RELEVANCE AND OUTRANKS EVERY OTHER SELECTION RULE. The engagements shown must leave no uncovered interval longer than 4 months between the employer_dates start and the first engagement, between any two consecutive engagements, or between the most recent engagement and the present. When a structural failure or QA issue names a gap, close it by ADDING the engagement from the Super Resume that covers it - never by adjusting a date, never by dropping something else first. If that pushes you over the line budget, take the lines back from the least relevant engagement's bullets. A continuity-mandatory engagement may be reduced to a single bullet, but it must still appear with its client, role, and dates, and it must never be removed. Record anything you cannot cover in ats_notes.coverage_gaps.
- Every engagement carries a role: the job title actually held, matching the Super Resume engagement header for that client. Preserve existing roles exactly. Never invent, upgrade, generalize, or harmonize a title.
- House rule 7 applies. When a structural failure names a trajectory or ramp-time clause, delete the clause rather than rewording it, and replace it only with a concrete accomplishment an existing bullet already proves.
- Summary sentence 3 names a concrete analogous system, constraint, or user population that a bullet in this resume proves.
- No skills entry uses a parenthetical to narrow a claim. Parentheses may contain only an acronym for the same term.
- Bullet allocation tracks relevance to the posting, not recency. When cutting bullets, cut from the least relevant engagement first.
- Name recognition is a tiebreaker, not a rule. Never drop a continuity-mandatory engagement to make room for a recognizable client. When a structural failure names a required client as missing, add it; if that pushes the resume over the line budget, take the lines back from the least relevant engagement's bullets, and update ats_notes.recognition_selections so the notes describe the resume you actually produced.
- Keep every industry field to at most 26 characters, a single category with no slash. Shorten by dropping the second qualifier, not by abbreviating words.
- Bullet counts must be unequal and must track relevance: the engagement with the strongest evidence for this posting holds the most bullets. An engagement carried only to close a continuity gap is expected to hold one or two bullets. Never embellish a recognized client's bullets to justify its slot.
- No skill name ends in "thinking," "mindset," "awareness," "exposure," or "adjacent."
- Rendered length is measured in LINES, not words. Read the RENDERED LENGTH block: estimated_lines must not exceed line_budget. A bullet costs ceil(characters / 104) lines whatever its word count, so trimming two words off every bullet usually removes zero lines. To remove lines, remove or merge whole bullets, starting with the wasteful_bullets you are given - those are bullets whose final line is nearly empty, and pulling one back under a line boundary removes a full line for a few characters of edit.
- location_line is exactly as given under FIXED CANDIDATE FACTS.

EDIT PRIORITIES

1. Fix every structural failure.
2. Remove or correct every fabrication flag.
3. Apply every revision instruction QA marked as thesis execution. These name a product surface this team owns that the resume does not currently speak to, and the Super Resume evidence that should cover it. Reframe emphasis and vocabulary on an existing bullet so the parallel is legible to someone who works on that surface. Never add a fact.
4. Make every QA visibility gap clear in the summary, skills, or evidence bullets.
5. Apply each remaining revision instruction.
6. Preserve the umbrella structure and reverse-chronological engagement order.
7. Keep education exactly as listed under FIXED CANDIDATE FACTS.
8. Update ats_notes.requirement_alignment and ats_notes.coverage_gaps to reflect the corrected resume.
9. Use plain text in JSON strings with no markdown characters.

OUTPUT BUDGET

- Return the complete corrected JSON immediately.
- Do not narrate reasoning or list changes.
- Preserve unchanged content without expansion.
- Return only one JSON object.
- Keep the response below 12,000 tokens.
```

## User message template

```text
=Apply the QA corrections to the existing resume and return the complete corrected resume JSON.

TARGET:
{{ $json.job_data.job_title }} at {{ $json.job_data.company_name }}

NORMALIZED REQUIRED REQUIREMENTS:
{{ JSON.stringify($json.job_data.requirements_required || [], null, 2) }}

QA REQUIREMENT ASSESSMENT:
{{ JSON.stringify($json.qa.requirement_assessment || [], null, 2) }}

QA REVISION INSTRUCTIONS:
{{ JSON.stringify($json.qa.revision_instructions || [], null, 2) }}

STRUCTURAL FAILURES — DETERMINISTIC, NON-NEGOTIABLE. EVERY ITEM MUST BE FIXED:
{{ JSON.stringify($json.structural_failures || [], null, 2) }}

FABRICATION FLAGS:
{{ JSON.stringify($json.qa.fabrication_flags || [], null, 2) }}

SEMANTICALLY UNMET REQUIRED REQUIREMENTS:
{{ JSON.stringify($json.qa.unmet_required || [], null, 2) }}

VALID MATCHES NOT CLEARLY VISIBLE:
{{ JSON.stringify($json.qa.visibility_gaps || [], null, 2) }}

MISSING LITERAL ATS TERMS — ADVISORY; ADD ONLY WHEN SUPPORTED AND NATURAL:
{{ ($json.coverage.missing_required || []).join(', ') || 'none' }}

RENDERED LENGTH — MEASURED IN LINES:
Estimated lines: {{ $json.layout.estimated_lines }} / budget {{ $json.layout.line_budget }}
Over budget by: {{ $json.layout.over_by_lines }} lines. When this is above zero you must remove lines, and the cheapest place to remove them is listed next.
Bullets wasting most of their final line, cheapest cuts first:
{{ JSON.stringify(($json.layout || {}).wasteful_bullets || [], null, 2) }}

JOB THESIS — THE ARGUMENT THIS RESUME MUST MAKE:
{{ JSON.stringify($json.thesis || {}, null, 2) }}

CURRENT RESUME JSON:
{{ JSON.stringify($json.resume, null, 2) }}

SUPER RESUME — SOLE SOURCE OF CANDIDATE FACTS:
{{ $('Set Flavor Modifier').item.json.superResumeText }}
```

## Output schema ("Resume Parser (Refine)")

```json
{
  "type": "object",
  "required": [
    "summary",
    "location_line",
    "skills",
    "experience",
    "projects",
    "education",
    "ats_notes"
  ],
  "properties": {
    "summary": {
      "type": "string"
    },
    "location_line": {
      "type": "string"
    },
    "skills": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "group",
          "items"
        ],
        "properties": {
          "group": {
            "type": "string"
          },
          "items": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    },
    "experience": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "employer",
          "employer_title",
          "employer_dates",
          "employer_summary",
          "engagements"
        ],
        "properties": {
          "employer": {
            "type": "string"
          },
          "employer_title": {
            "type": "string"
          },
          "employer_dates": {
            "type": "string"
          },
          "employer_summary": {
            "type": "string"
          },
          "engagements": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "client",
                "role",
                "industry",
                "dates",
                "bullets"
              ],
              "properties": {
                "client": {
                  "type": "string"
                },
                "role": {
                  "type": "string",
                  "description": "The job title actually held on this engagement, copied from the Super Resume engagement header."
                },
                "industry": {
                  "type": "string"
                },
                "dates": {
                  "type": "string"
                },
                "bullets": {
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              }
            }
          }
        }
      }
    },
    "projects": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "name",
          "description",
          "bullets"
        ],
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "bullets": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      }
    },
    "education": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "school",
          "credential",
          "location",
          "year"
        ],
        "properties": {
          "school": {
            "type": "string"
          },
          "credential": {
            "type": "string"
          },
          "location": {
            "type": "string"
          },
          "year": {
            "type": "string"
          }
        }
      }
    },
    "ats_notes": {
      "type": "object",
      "required": [
        "matched_keywords",
        "stretch_claims",
        "requirement_alignment",
        "recognition_selections"
      ],
      "properties": {
        "matched_keywords": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "stretch_claims": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requirement_alignment": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "requirement",
              "category",
              "status",
              "evidence",
              "resume_expression"
            ],
            "properties": {
              "requirement": {
                "type": "string"
              },
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
              "status": {
                "type": "string",
                "enum": [
                  "direct",
                  "equivalent",
                  "partial",
                  "unmatched"
                ]
              },
              "evidence": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "resume_expression": {
                "type": "string"
              }
            }
          }
        },
        "recognition_selections": {
          "type": "array",
          "description": "Records any engagement chosen partly for the client's name recognition rather than keyword relevance alone. Empty array when selection was relevance-only.",
          "items": {
            "type": "object",
            "required": [
              "included_client",
              "displaced_client",
              "recognition_basis",
              "requirements_evidenced",
              "displaced_unique_requirements"
            ],
            "properties": {
              "included_client": {
                "type": "string",
                "description": "Client name of the engagement kept on recognition grounds."
              },
              "displaced_client": {
                "type": "string",
                "description": "Client name of the lower-relevance engagement it replaced."
              },
              "recognition_basis": {
                "type": "string",
                "description": "Why a non-technical reviewer would recognize this organization unaided."
              },
              "requirements_evidenced": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "Posting requirements this engagement still evidences. Must not be empty."
              },
              "displaced_unique_requirements": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "Posting requirements the displaced engagement was the ONLY evidence for. Must be empty, otherwise the swap is invalid."
              }
            }
          }
        },
        "coverage_gaps": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Intervals longer than 4 months that the selected engagements do not cover. Empty array when the timeline is continuous."
        }
      }
    }
  }
}
```
