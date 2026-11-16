# StreamTube no Codex

Leia CLAUDE.md para arquitetura, convenções e Definition of Done. Para o backend, aplique também nestjs-project/AGENTS.md. Use docs/project-plan.md como fonte de escopo e docs/decisions/ para decisões vigentes.

Execute research → decide → plan-context → plan-validate → plan-resolve (repita a validação até clean) → plan-build → plan-test-specs (opcional) → implement. Use as skills em .agents/skills. Preserve contratos e artefatos do workflow original. A Fase 03 usa docs/decisions/technical-decisions-phase-03-videos.md conforme o enunciado.

As skills acionam os leitores de .codex/agents nas etapas indicadas no workflow original. Sem delegação disponível, execute o mesmo protocolo de leitura na sessão principal e conserve a estrutura de saída. Traduza AskUserQuestion para a ferramenta de perguntas disponível e TaskCreate/TaskUpdate para o acompanhamento dos SIs no progress.md.

A configuração MCP fica em .codex/config.toml e é carregada ao abrir a raiz como projeto confiável em uma nova sessão. Context7 valida documentação e versões. O MCP PostgreSQL usa o banco local de desenvolvimento, exposto pelo Compose em 5432. O MCP roda em container descartável, usando host.docker.internal para alcançar o PostgreSQL publicado. Serviços da stack comunicam-se por nomes do Compose.
