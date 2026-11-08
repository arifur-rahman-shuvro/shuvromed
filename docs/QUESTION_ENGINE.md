# Question engine (Phase 4)

Four types: SBA (single best answer), MULTIPLE_MCQ, TRUE_FALSE, FILL_GAP.

- Contract: `src/questions/schema.ts` (zod). Mirrors SQL `valid_question_payload`; `contract-fixtures.json` is run through both TS and DB tests.
- Grading: `src/questions/grade.ts`. Each question is worth at most 1 mark. SBA/TF can carry negative marking. MULTIPLE: exact or partial credit `(right - wrong*w)/correct`. FILL_GAP: per blank, with NFKC / trim / space-collapse / case-fold options. Blank marker in the stem: `{{id}}`.
- Storage: `src/questions/repo.ts` over the on-device store; topic links are a composite-key link table synced incrementally.
- Versions: a server trigger bumps `current_version` only when type, stem, content, explanation, reference or difficulty change. Tag/topic/archive changes do not.
- Screens (hidden behind Settings > Experimental): My questions list, editor with Edit/Preview, draft autosave, duplicate warning, archive/delete with Undo.
- Known constraint for Phase 8: several local edits made offline become one server version.

## Pending production change
M6.1 `20261108150000_fix_true_false_check.sql` (replaces one function only). Not applied; needs owner approval.
