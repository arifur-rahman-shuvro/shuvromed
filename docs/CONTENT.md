# Content guide: subjects, topics, exam styles, formats and questions

Everything a student sees about the curriculum is **data** in the `content/` folder. Adding a subject, topic,
exam style or question format needs no app code change.

```
content/
  subjects.json          list of subjects
  topics/<subject>.json  topics for one subject (hierarchical via parentId)
  exam-styles.json       MBBS, MRCS, USMLE, UKMLA, PLAB ... (add more here)
  question-formats.json  sba-5, mcq-4 ... (option counts are enforced from here)
  questions/*.json       questions (any number of files)
```

Every file is a JSON array. All of it is checked by one set of Zod schemas (`src/content/schema.ts`).

## Add things

| To add | Do this |
|---|---|
| A subject | Add an entry to `subjects.json`: `{ "id": "ophthalmology", "name": "Ophthalmology", "sortOrder": 160 }` |
| A topic | Add to `topics/<subject>.json`: `{ "id": "...", "subjectId": "...", "parentId": null or a parent topic id, "name": "...", "sortOrder": 10 }`. Parent and child must be in the same subject. |
| An exam style | Add `{ "id": "fcps", "name": "FCPS-style" }` to `exam-styles.json`, then use `"fcps"` in a question's `examTags`. |
| A question format | Add `{ "id": "sba-4", "name": "...", "minOptions": 4, "maxOptions": 4 }` to `question-formats.json`. |
| Questions | Add to a file under `questions/`, or bulk import (below). |

IDs are lowercase letters, digits and hyphens. A subject with no published questions still appears in the app,
labelled "No questions yet".

## Check your content

```
npm run content:validate                       # errors fail (exit 1)
npm run content:validate -- --fail-on-warnings # CI uses this
```

It catches: missing fields, duplicate ids, unknown subject/topic/format/exam style, a topic whose parent is in
another subject or forms a loop, wrong option count for the format, a correct answer that is not an option,
missing option analysis, duplicate option text, invalid reference links, and an unreviewed or demo question
marked Published. It warns when an explanation says "Option C" (options are shuffled, so letters mislead).

## Bulk import (CSV or JSON)

```
npm run content:import -- my-questions.csv --dry-run   # check only, writes nothing
npm run content:import -- my-questions.csv             # writes content/questions/imported-my-questions.json
```

* **Imports can never publish.** Every imported question is written as `draft` and `unreviewed`, even if the
  file says otherwise (you will see a `status-reset` warning).
* Nothing is written unless the **whole** content set, existing plus new, validates.
* CSV columns: `id, subjectId, topicId, difficulty, format, examTags, stem, optionA..optionE, correctOptionId,
  explanation, analysisA..analysisE, clinicalPearl, learningObjectives, references`.
  Leave `optionE`/`analysisE` empty for 4-option questions. `examTags` and `learningObjectives` are separated by `;`.
  `references` is optional and, if present, must be a JSON array in that one cell. **Only list references that
  really exist; never invent editions or page numbers.**
* `--out` must be a `.json` file inside `content/questions/`. `--force` replaces an existing output file.

## Review workflow

Draft -> Needs review -> Approved -> Published -> Archived (`status` in each question).

A question reaches students only when **all** are true: `status` is `published`, `unreviewed` is `false`,
`isDemo` is `false`, it has at least one reference, and its subject and topic are active. The one exception is
the built-in **DEMO** set (`isDemo: true`), which is always labelled DEMO in the app and can never be published.
AI-written questions stay `unreviewed: true` until the owner approves them.

## What ships to the website

`npm run build` first runs `content:build`, which validates everything (a failure stops the build) and writes
static files to `public/content/` (git-ignored): `manifest.json`, `taxonomy.json` and one
`questions/<subject>.json` per subject. Only student-visible questions are included, so drafts never leave the
repository. Set `CONTENT_INCLUDE_DEMO=0` to build without the DEMO questions.

## Known limits (honest)

* The shipped bank is **8 DEMO questions** across Anatomy, Physiology and Pharmacology. It is not a real question bank.
* The DEMO questions carry no references and have not been clinically reviewed.
* There is no admin web page yet; import and review are done with the commands above (an owner-only admin page is planned).
