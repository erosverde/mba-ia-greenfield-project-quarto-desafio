---
name: plan-build
description: "Stage 4 of the plan pipeline (phase and task modes). Runs abort-fast preflight checks (mode detection, context.md + validation.md present and fresh, status clean, library-refs.md present if required, resume detection) and writes the final phase-NN-{slug}.md or task-{slug}.md artifact directly from the main thread. The procedure is split across companion files: phase-a.md (scaffold + Technical Specifications + pause), phase-b.md (Step Implementations + Dependency Map + Deliverables), phase-c.md (append-mode for incremental delta builds). The pause between Phase A and Phase B creates a natural review checkpoint. Use as the final stage after validation.md reports clean. Triggers: 'plan-build NN', 'plan-build <slug>', 'build the phase NN', 'build task <slug>'."
---

Leia .claude/skills/plan-build/SKILL.md na raiz e execute o procedimento e os contratos de artefato ali definidos. Resolva os recursos auxiliares junto da skill original. Aplique as adaptações de ferramentas e delegação descritas no AGENTS.md da raiz.
