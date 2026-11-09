# Import, export and the paste kit (Phase 6)

Screen: Settings > Experimental > Open Import / export (`/app/workspace/import`). Hidden until the cutover.

## Rules
- **Dry run first.** Press Check: nothing is saved. The report says how many questions will be added, which are duplicates (skipped unless you tick the box), which have problems (and why, with the line), and which subjects, topics and tags will be created. Import then carries out exactly that plan.
- **Import writes to the device store.** The normal sync sends it later, so it works offline. No server import function, no production migration.
- **Nothing existing is changed.** Subjects, topics and tags are matched by name (case and spacing ignored) and reused; only missing ones are created.
- **Duplicates** are judged by wording (case, spacing and blank markers ignored), against your questions and against earlier ones in the same file.
- A question with problems is left out and reported; the others still import. Questions are saved in batches of 200.
- Limit: 10 MB per file.

## Paste format
```
Subject: Anatomy              lines BEFORE a question set defaults for it and all later questions
Topic: Thorax > Heart         several topics: separate with ;     (Topic: - clears it)
Exam: FCPS Part 1, MBBS       optional; none = Universal
Tags: high yield
Difficulty: hard

Q: Which valve lies between the left atrium and ventricle?
A) Tricuspid
B) Mitral *                   trailing * marks a correct option (or add: Answer: B)
C) Aortic
Explanation: ...
Reference: ...
---                           closes the question (a new Q: also does)
```
- Several `*` (or `Answer: A, C`) = multiple-answer. `Type: Multiple|SBA|TF|Gap` forces a type.
- True/false: `Q: statement` then `Answer: True`.
- Fill the gap: `Q: The [heart|cardiac muscle] pumps blood.` (| separates accepted alternatives).
- Inside a question (after `Q:`), Subject/Topic/Exam/Tags/Difficulty apply to that question only.
- The prompt kit on the screen (`src/transfer/kit.ts`) teaches any chatbot this format; a test parses its own example.

## JSON file format (`shuvromed-questions`, version 1)
`{ "format": "shuvromed-questions", "version": 1, "exported_at": "...", "questions": [ { "subject", "topics": [["Thorax","Heart"]], "exam_tags": [], "tags": [], "type", "stem", "content", "difficulty", "explanation", "reference" } ] }`
Names, never ids, so a file works on any account. `content` has the same shape as the question contract (docs/QUESTION_ENGINE.md). A bare list of questions is also accepted. A newer `version` is refused with a clear message.

## Export
Downloads every non-deleted question with subjects, topics and tags in the format above; importing it again (or into another account) recreates them.

## Code
`src/transfer/`: `paste.ts`, `file.ts` (readers), `plan.ts` (dry run), `run.ts` (carries out the plan), `export.ts`, `kit.ts`; `QuestionRepo.createMany`.
