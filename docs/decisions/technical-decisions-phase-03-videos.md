---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-11-16
scope_description: "Decisões de backend para upload, processamento e entrega de vídeo"
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — API, infraestrutura e worker. A interface de vídeo fica fora do escopo conforme o enunciado.

O escopo vem de [project-plan.md](../project-plan.md) e do enunciado. A base consultada usa NestJS 11.1.16, TypeORM 0.3.28 e pg 8.20.0 no lockfile, com PostgreSQL 17 no Compose. As decisões da Fase 02 de autenticação, usuário e canal são herdadas. Context7 consultado via MCP para BullMQ (`/taskforcesh/bullmq`), S3 (`/websites/aws_amazon_s3`) e FFmpeg (`/websites/ffmpeg_documentation`). A compatibilidade e as versões de novas dependências serão fixadas em `plan-resolve`.

## TD-01: Fila de processamento

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O Compose precisa de uma fila durável e um worker independente. A API precisa registrar a intenção de processar junto com a mudança de estado (TD-06).

**Options:**

### Option A: BullMQ + Redis

- API publica jobs identificados pelo ID do vídeo. O worker usa retries com backoff.
- **Pros:** Integração documentada com NestJS e operação simples para jobs.
- **Cons:** Exige Redis persistente e reconciliação entre PostgreSQL e Redis. [NestJS Queues](https://docs.nestjs.com/techniques/queues) · [BullMQ retries](https://docs.bullmq.io/guide/retrying-failing-jobs)

### Option B: RabbitMQ

- API publica em uma fila durável com publisher confirms. Worker confirma após persistir o resultado.
- **Pros:** Broker dedicado com confirmações explícitas.
- **Cons:** Exige desenhar topologia de retries, dead lettering e idempotência. [RabbitMQ confirms](https://www.rabbitmq.com/docs/confirms)

### Option C: pg-boss

- Usa PostgreSQL como fila com workers e retries gerenciados pela biblioteca.
- **Pros:** Reaproveita PostgreSQL e permite avaliar enfileiramento transacional.
- **Cons:** Jobs compartilham recursos com a aplicação. A topologia de fila separada do Compose precisaria ser esclarecida. [pg-boss](https://github.com/timgit/pg-boss)

**Recommendation:** A (BullMQ + Redis) — fila real isolada da carga transacional e integração com NestJS 11, com custo explícito de reconciliar a publicação.

**Decision:** A (BullMQ + Redis)

**Libraries:** bullmq@5.66.4

## TD-02: Upload direto e chaves de storage

**Scope:** Backend

**Capability:** Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** S3 compatível é a base, com MinIO local. O canal autenticado inicia um rascunho e a API controla quais chaves e partes podem ser gravadas.

**Options:**

### Option A: Multipart S3 com UploadPart pré-assinado

- API cria o rascunho e a sessão multipart. Cliente envia partes direto ao bucket privado e a API confirma a composição após verificar tamanhos e ETags.
- **Pros:** Retoma partes individualmente e dispensa tráfego de vídeo pela API.
- **Cons:** Exige expiração de sessões, limpeza de partes e recuperação se a composição concluir antes de a confirmação ser gravada. [S3 multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)

### Option B: Servidor tus dedicado com S3

- Cliente envia segmentos a um serviço tus separado que armazena no S3. A aplicação correlaciona a conclusão ao rascunho.
- **Pros:** Protocolo de retomada padronizado e clientes existentes.
- **Cons:** Adiciona um serviço no caminho dos bytes e exige integração de autorização e conclusão. [tus protocol](https://tus.io/protocols/resumable-upload)

**Recommendation:** A (multipart S3) — usar bucket privado com chaves por ID de vídeo e artefato. Planejar validação dos 10 GB a partir dos tamanhos observados no storage, credenciais limitadas e distinção entre endereço interno e endereço usado pelo cliente.

**Decision:** A (Multipart S3)

**Libraries:** @aws-sdk/client-s3@3.935.0, @aws-sdk/s3-request-presigner@3.935.0

## TD-03: Worker e thumbnail

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** O workload de mídia precisa de limites independentes da API e deve aceitar leitura com busca para inspecionar formatos que dependem do final do arquivo.

**Options:**

### Option A: Arquivo temporário com ffprobe e FFmpeg

- Worker baixa para disco por streaming, lê metadados JSON com ffprobe e extrai um frame JPEG com FFmpeg. Limpa os temporários ao encerrar o job.
- **Pros:** Acesso aleatório previsível e isolamento de CPU, memória e disco em container separado.
- **Cons:** O disco precisa comportar os jobs concorrentes e a leitura transfere o original inteiro. [ffprobe](https://ffmpeg.org/ffprobe.html) · [FFmpeg](https://ffmpeg.org/ffmpeg.html)

### Option B: Leitura remota com HTTP Range

- Worker fornece URL assinada do objeto ao FFmpeg e ao ffprobe. Os processos consultam o storage durante a análise e extração.
- **Pros:** Reduz necessidade de disco local e pode ler só parte do arquivo.
- **Cons:** A busca depende de formato, transporte, disponibilidade de storage e validade da URL. [FFmpeg HTTP protocol](https://ffmpeg.org/ffmpeg-protocols.html#http)

**Recommendation:** A (arquivo temporário) — prioriza compatibilidade e previsibilidade. Fixar concorrência pelo orçamento de disco e executar os binários com timeout e argumentos estruturados.

**Decision:** A (Arquivo temporário + FFmpeg)

**Libraries:** FFmpeg e ffprobe (Debian trixie)

## TD-04: Identificador público

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** O projeto exige um identificador estável para o vídeo, independente das credenciais temporárias de acesso ao storage.

**Options:**

### Option A: UUID aleatório com restrição UNIQUE

- A referência pública usa UUID estável e o banco garante unicidade.
- **Pros:** Independe do título e permite gerar o identificador antes do upload.
- **Cons:** URL menos legível. [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html)

### Option B: Slug de título com sufixo único

- A URL usa título normalizado e sufixo estável, com unicidade no banco.
- **Pros:** URL legível.
- **Cons:** Exige definir normalização, colisões e estabilidade após edição do título.

**Recommendation:** A (UUID) — permite emitir uma URL estável já no rascunho e delega a garantia de unicidade ao banco.

**Decision:** A (UUID)

**Libraries:** —

## TD-05: Streaming e download

**Scope:** Backend

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** A URL estável do vídeo decide se a mídia pronta pode ser servida. Os clientes precisam obter intervalos e distinguir reprodução de download.

**Options:**

### Option A: GET pré-assinado com redirecionamento

- Após verificar acesso e estado, a API redireciona para o storage privado. O storage serve Range e usa disposição inline ou attachment conforme a operação.
- **Pros:** Tráfego pesado e respostas 206 ficam no storage.
- **Cons:** URL temporária precisa de renovação e o cliente deve alcançar o endereço público do storage. [S3 GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html) · [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests)

### Option B: Proxy de Range na API

- API repassa Range ao storage e transmite o corpo com backpressure e cabeçalhos de intervalo.
- **Pros:** Mesmo domínio e controle do acesso a cada requisição.
- **Cons:** Mantém conexões e tráfego de mídia na API. [S3 GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)

**Recommendation:** A (GET pré-assinado) — mantém os bytes fora da API. O plano precisa fechar política de acesso, formatos reproduzíveis, estratégia para MP4 com índice ao final e comportamento de seek após expiração.

**Decision:** A (GET pré-assinado)

**Libraries:** @aws-sdk/client-s3@3.935.0, @aws-sdk/s3-request-presigner@3.935.0

## TD-06: Ciclo de estados e recuperação

**Scope:** Backend

**Capability:** Transversal — covers: Pré-cadastro automático do vídeo como rascunho ao iniciar o upload; Serviço de processamento em segundo plano (filas); Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** As operações de composição S3, gravação no PostgreSQL e envio ao broker falham de forma independente. Jobs podem ser entregues mais de uma vez.

**Options:**

### Option A: Outbox transacional e consumidor idempotente

- Após verificar o objeto completo, a API grava PROCESSING e a intenção de publicação na mesma transação. Dispatcher reenvia com ID estável. Worker grava READY após thumbnail e metadados ou ERROR após falha definitiva.
- **Pros:** Uma reinicialização entre commit e publicação deixa uma intenção recuperável. Status persiste no banco.
- **Cons:** Exige dispatcher, política de retenção e reconciliação de jobs terminais e processamento interrompido. [BullMQ job IDs](https://docs.bullmq.io/guide/jobs/job-ids)

### Option B: Reconciliação pelo estado do próprio vídeo

- Um reconciliador reavalia vídeos PROCESSING e republica jobs ausentes. READY e ERROR são terminais.
- **Pros:** Evita tabela de outbox para uma única operação.
- **Cons:** A consulta precisa distinguir job ausente, ativo e terminal sem refazer trabalho ou ressuscitar erros. [BullMQ stalled jobs](https://docs.bullmq.io/guide/jobs/stalled)

**Recommendation:** A (outbox) — torna explícita a intenção durável. Planejar DRAFT → PROCESSING → READY/ERROR, retries com backoff para falhas transitórias e reconciliação da confirmação multipart e dos erros terminais.

**Decision:** A (Outbox transacional)

**Libraries:** bullmq@5.66.4, typeorm@0.3.28

## Decisions Summary

Opções A confirmadas pelo autor em 2026-11-16 e registradas em plan-resolve.

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Backend | Fila de processamento | A (BullMQ + Redis) | A (BullMQ + Redis) |
| TD-02 | Backend | Upload direto e chaves de storage | A (multipart S3) | A (Multipart S3) |
| TD-03 | Backend | Worker e thumbnail | A (arquivo temporário) | A (Arquivo temporário + FFmpeg) |
| TD-04 | Backend | Identificador público | A (UUID) | A (UUID) |
| TD-05 | Backend | Streaming e download | A (GET pré-assinado) | A (GET pré-assinado) |
| TD-06 | Backend | Ciclo de estados e recuperação | A (outbox) | A (Outbox transacional) |
