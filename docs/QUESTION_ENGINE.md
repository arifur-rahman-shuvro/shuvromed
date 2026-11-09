# Question engine (Phase 4)

Four types: SBA (single best answer), MULTIPLE_MCQ, TRUE_FALSE, FILL_GAP.

- Contract: `src/questions/schema.ts` (zod). Mirrors SQL `valid_question_payload`; `contract-fixtures.json` is run through both TS and DB tests.
- Grading: `src/questions/grade.ts`. Each question is worth at most 1 mark. SBA/TF can carry negative marking. MULTIPLE: exact or partial credit `(right - wrong*w)/correct`. FILL_GAP: per blank, with NFKC / trim / space-collapse / case-fold options. Blank marker in the stem: `{{id}}`.
- Storage: `src/questions/repo.ts` over the on-device store; topic links are a composite-key link table synced incrementally.
- Versions: a server trigger bumps `current_version` only when type, stem, content, explanation, reference or difficulty change. Tag/topic/archive changes do not.
- Screens (hidden behind Settings > Experimental): My questions list, editor with Edit/Preview, draft autosave, duplicate warning, archive/delete with Undo.
- Known constraint for Phase 8: several local edits made offline become one server version.

## Production change history
M6.1 `20261108150000_fix_true_false_check.sql` replaced one function only. Approved and applied 2026-11-09 after a green backup; verified (bad true/false rejected, good accepted, data unchanged).

## Tags (Phase 5)
- Two groups, kept separate: **exam** and **general**. A name is unique within its group (case and spacing ignored).
- **Universal** = a question with no exam tag. General tags never change that. It is derived (`isUniversal` in `src/tags/repo.ts`), not stored.
- Deleting a tag removes its links and keeps the questions (the database does the same). Archiving a tag hides it from pickers; questions keep it.
- Tag changes never create a question version.
- Bulk classify: select questions on My questions, pick a tag, Add or Remove; saved atomically, with Undo. A question holds at most 60 tags.
- Screens (hidden behind Settings > Experimental): My tags, tag picker in the question editor, tag chips and Universal badge in the list.
- No production database change: M6 already had `user_tags` and `user_question_tag_links`.
