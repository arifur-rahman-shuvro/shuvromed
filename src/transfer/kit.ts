/** The text a person copies into any chatbot, followed by their own notes. The reply can be pasted straight into Import. */
export const PROMPT_KIT = `Turn the study notes I give you into exam questions in EXACTLY the plain-text format below. Reply with only the questions, no commentary.

FORMAT
- Put these lines first, once, and repeat one only when it changes:
  Subject: <subject name>
  Topic: <topic> > <subtopic>        (optional; separate several topics with ;)
  Exam: <exam name>, <exam name>     (optional; leave out if the question suits every exam)
  Tags: <tag>, <tag>                 (optional)
  Difficulty: easy | medium | hard   (optional)
- Start every question with "Q:" and end it with a line containing only ---
- Single best answer: give options as "A) ...", "B) ..." and put * at the end of the ONE correct option.
- Multiple correct answers: same, but put * on TWO OR MORE correct options and add the line "Type: Multiple".
- True/False: write the statement after "Q:" and add "Answer: True" or "Answer: False".
- Fill in the gap: write the sentence after "Q:" with each missing word in [square brackets]. Alternatives that are also correct go inside the same brackets separated by |, for example: The [heart|cardiac muscle] pumps blood.
- After the answer you may add "Explanation: ..." and "Reference: ...".

EXAMPLE
Subject: Anatomy
Topic: Thorax > Heart
Exam: FCPS Part 1
Difficulty: medium

Q: Which valve lies between the left atrium and the left ventricle?
A) Tricuspid
B) Mitral *
C) Aortic
D) Pulmonary
Explanation: The mitral (bicuspid) valve guards the left atrioventricular opening.
---
Q: The heart has four chambers.
Answer: True
---
Q: Blood leaves the left ventricle through the [aorta].
---

MY NOTES
(paste your notes here)`
