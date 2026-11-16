---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-11-16T15:46:25.7810283Z"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-16T16:03:14.0305530Z"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-11-16T15:50:54.1974142Z"
  docs/phases/phase-02-auth/phase-02-auth.md: "2026-11-16T15:50:54.2217778Z"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities**

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** Interface de vídeo, edição, publicação e demais operações da Fase 04.

**Deliverables:** upload de até 10 GB, processamento automático, streaming, download e URLs únicas. Inclui migration, worker, Compose e testes.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/`

**Sequencing notes:** depende das Fases 01 (infra e PostgreSQL) e 02 (autenticação, usuário e canal).

**Neighbors (for boundary detection only):** Fase 02 (autenticação), Fase 04 (gerenciamento de vídeos e canal).

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Backend | Fila de processamento | decided | A (BullMQ + Redis) | BullMQ, Redis |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Backend | Upload direto e chaves de storage | decided | A (Multipart S3) | AWS SDK v3, MinIO |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Backend | Worker e thumbnail | decided | A (Arquivo temporário + FFmpeg) | FFmpeg e ffprobe |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend | Identificador público | decided | A (UUID) | node:crypto |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Streaming e download | decided | A (GET pré-assinado) | AWS SDK v3 |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Backend | Ciclo de estados e recuperação | decided | A (Outbox transacional) | TypeORM e BullMQ |

_Source files:_

- `docs/decisions/technical-decisions-phase-03-videos.md`
- `docs/decisions/technical-decisions-phase-02-auth.md`

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-02 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-06 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-06 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-03, phase-03-videos/TD-06 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-03 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-04 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-05 |
| Download do vídeo pelo usuário | phase-03-videos/TD-05 |

## Decisions Detail

### phase-03-videos/TD-01

- **Decision:** A (BullMQ + Redis)
- **Recommendation:** A (BullMQ + Redis) — fila real isolada da carga transacional e integração com NestJS 11, com custo explícito de reconciliar a publicação.
- **Libraries:** BullMQ, Redis

### phase-03-videos/TD-02

- **Decision:** A (Multipart S3)
- **Recommendation:** A (multipart S3) — usar bucket privado com chaves por ID de vídeo e artefato. Planejar validação dos 10 GB a partir dos tamanhos observados no storage, credenciais limitadas e distinção entre endereço interno e endereço usado pelo cliente.
- **Libraries:** AWS SDK v3, MinIO

### phase-03-videos/TD-03

- **Decision:** A (Arquivo temporário + FFmpeg)
- **Recommendation:** A (arquivo temporário) — prioriza compatibilidade e previsibilidade. Fixar concorrência pelo orçamento de disco e executar os binários com timeout e argumentos estruturados.
- **Libraries:** FFmpeg e ffprobe

### phase-03-videos/TD-04

- **Decision:** A (UUID)
- **Recommendation:** A (UUID) — permite emitir uma URL estável já no rascunho e delega a garantia de unicidade ao banco.
- **Libraries:** node:crypto

### phase-03-videos/TD-05

- **Decision:** A (GET pré-assinado)
- **Recommendation:** A (GET pré-assinado) — mantém os bytes fora da API. O plano precisa fechar política de acesso, formatos reproduzíveis, estratégia para MP4 com índice ao final e comportamento de seek após expiração.
- **Libraries:** AWS SDK v3

### phase-03-videos/TD-06

- **Decision:** A (Outbox transacional)
- **Recommendation:** A (outbox) — torna explícita a intenção durável. Planejar DRAFT → PROCESSING → READY/ERROR, retries com backoff para falhas transitórias e reconciliação da confirmação multipart e dos erros terminais.
- **Libraries:** TypeORM e BullMQ

## Inherited Decisions Detail

- **phase-02-auth/TD-02:** guard JWT e decorator de usuário atual. Upload exige autenticação.
- **phase-02-auth/TD-06:** class-validator e class-transformer para entrada.
- **phase-02-auth/TD-07:** exceção de domínio e filtro para erros da API.
- **phase-02-auth/TD-08:** rate limiting global.
- **phase-02-auth/TD-10:** cada usuário tem um canal criado no cadastro. O dono do vídeo é derivado do usuário autenticado.

## Inherited Conventions

- PostgreSQL 17, NestJS 11 e TypeORM. Migrações versionadas e transações explícitas.
- Serviços Docker usam nomes do Compose para comunicação interna. Endereços pré-assinados precisam ser alcançáveis pelos clientes.
- Contratos HTTP documentados em OpenAPI.

## Inherited Deferred Capabilities

_None._

## Non-UI / Deferred Capabilities

A fase entrega contratos HTTP e processamento em backend. Gerenciamento e publicação pertencem à Fase 04.

## Testing Requirements

- NestJS usa `*.spec.ts`, `*.integration-spec.ts` e `*.e2e-spec.ts`.
- Testar filas, worker, Postgres e object storage com serviços reais no Compose.
- A Definition of Done exige `npm test`, `npm run test:e2e`, `npx tsc --noEmit` e `npm run lint`.

## Resolved Implementation Constraints

- TD-02: interpretar 10 GB como 10.000.000.000 bytes. Sessão com partes de 64 MiB, validade de 24 h e URLs PUT de 15 min. Autorizar por canal e conferir tamanho de cada parte com ListParts antes de compor. Abortar sessões expiradas e recuperar confirmação interrompida com HeadObject da chave exclusiva.
- TD-03 e TD-05: mídia MP4 com vídeo H.264 e áudio AAC opcional. Worker valida o conteúdo real, extrai duração e thumbnail JPEG e remuxa para MP4 faststart por cópia de streams. Manter o original para download. Concorrência inicial 1 e provisionamento de disco para original e saída temporários.
- TD-04 e TD-05: UUID estável. Status de upload visível ao dono. Reprodução, thumbnail e download públicos somente em READY, seguindo a visão de reprodução anônima do CLAUDE.md. URLs GET expiram e são renovadas pela rota estável.
- TD-06: transação de PROCESSING e outbox. Job estável por vídeo, até três tentativas com backoff exponencial, falha permanente sem retry. Reconciliar job terminal ou ausente e persistir erro sanitizado. Publicação só após validação do objeto, marcação READY após upload dos artefatos e conclusão idempotente.
