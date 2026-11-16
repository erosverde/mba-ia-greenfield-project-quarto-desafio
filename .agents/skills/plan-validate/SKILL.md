---
name: plan-validate
description: "Stage 2 of the plan pipeline (phase and task modes). Reads context.md (which embeds `## Decisions Detail` and `## Inherited Decisions Detail` with Recommendation + Libraries per TD), detects inconsistencies, ambiguities, missing decisions, dependency gaps (phase mode), and inherited-constraint conflicts. Produces or regenerates validation.md with a status: clean|dirty verdict. Use after /plan-context <arg> and after each /plan-resolve <arg> cycle. Triggers: 'plan-validate NN', 'plan-validate <slug>', 'valida a fase NN', 'run validation stage'."
---

Leia .claude/skills/plan-validate/SKILL.md na raiz e execute o procedimento e os contratos de artefato ali definidos. Resolva os recursos auxiliares junto da skill original. Aplique as adaptações de ferramentas e delegação descritas no AGENTS.md da raiz.
