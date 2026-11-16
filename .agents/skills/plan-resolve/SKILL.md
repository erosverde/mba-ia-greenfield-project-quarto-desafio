---
name: plan-resolve
description: "Stage 3 of the plan pipeline (phase and task modes). Reads validation.md, asks the user via AskUserQuestion, and applies the answers to the decisions doc (filling **Decision:** fields, injecting superseded markers, or creating the decisions doc on-the-fly in task-sem-research), context.md (patching the Decisions Index), and validation.md (marking issues resolved). Dispatches Context7 for newly decided libraries and writes library-refs.md. In phase mode, aborts on MD-N with a /research instruction. In task mode, MD-N may be resolved inline by creating the decisions doc. Use after /plan-validate <arg> reports status: dirty. Triggers: 'plan-resolve NN', 'plan-resolve <slug>', 'resolve issues da fase NN', 'apply decisions to task <slug>'."
---

Leia .claude/skills/plan-resolve/SKILL.md na raiz e execute o procedimento e os contratos de artefato ali definidos. Resolva os recursos auxiliares junto da skill original. Aplique as adaptações de ferramentas e delegação descritas no AGENTS.md da raiz.
