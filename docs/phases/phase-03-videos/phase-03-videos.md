---
kind: phase
name: phase-03-videos
status: ready
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-16T16:04:52.4015131Z"
  docs/phases/phase-03-videos/validation.md: "2026-11-16T16:04:52.4396990Z"
  docs/phases/phase-03-videos/library-refs.md: "2026-11-16T16:12:43.7978253Z"
---

# Phase 03 — Upload e Processamento de Vídeos

Upload, processamento e entrega de mídia no backend, conforme [contexto](context.md) e TD-01 a TD-06. As dependências são as Fases 01 e 02. A interface de vídeo e a publicação editorial pertencem a fases separadas.

## Technical Specifications

### Data Model

| Tabela | Campos e invariantes |
|---|---|
| videos | id UUID PK usado na URL, channel_id FK de channels, title varchar(200), size_bytes bigint entre 1 e 10.000.000.000, status DRAFT/PROCESSING/READY/ERROR, upload_id nullable, upload_expires_at timestamptz, original_key, playback_key e thumbnail_key, duration_ms bigint nullable, metadata jsonb nullable, error_code nullable, created_at e updated_at. |
| video_processing_outbox | video_id UUID PK/FK, created_at, published_at nullable, next_attempt_at e attempts. Um evento por vídeo. |

Chaves determinísticas `videos/{id}/original.mp4`, `videos/{id}/playback.mp4` e `videos/{id}/thumbnail.jpg` em bucket privado. Chaves de artefato ficam nulas até READY. Metadados incluem dimensões, codecs e formato. UUID, status e time fields usam os padrões TypeORM do projeto. Tamanhos PostgreSQL bigint são convertidos explicitamente em valores seguros no contrato de saída.

### API Contracts

| Método e rota | Entrada | Sucesso |
|---|---|---|
| POST /videos/uploads | JSON {title, sizeBytes} com tamanho inteiro positivo | 201 {id, status, partSizeBytes, partCount, expiresAt}. Cria rascunho e inicia multipart. |
| POST /videos/:id/uploads/parts/:partNumber | UUID e número de parte entre 1 e partCount | 200 {url, validForSeconds, contentLength}. PUT direto ao storage com tamanho assinado e sem corpo na API. |
| POST /videos/:id/uploads/complete | UUID, sem corpo | 202 {id, status}. Lista partes do storage, verifica quantidade, ordem e tamanho, compõe e verifica objeto. Repetir confirmações de vídeo já entregue à fila retorna o estado atual. |
| GET /videos/:id | UUID | 200 {id, title, status, sizeBytes, durationMs, metadata, errorCode, streamUrl, thumbnailUrl, downloadUrl}. URLs de mídia aparecem em READY. |
| GET /videos/:id/stream | UUID e Range opcional | 307 para GET assinado sem fixar o Range. Storage responde 200/206/416. |
| GET /videos/:id/thumbnail | UUID | 307 para JPEG assinado. |
| GET /videos/:id/download | UUID | 307 para GET do original com Content-Disposition attachment. |

Parte de 64 MiB, exceto a última. Para uma sessão de 10 GB o máximo é 150 partes. URLs PUT e GET válidas até 15 min. Sessão DRAFT vence em 24 h. As rotas de redirect usam Cache-Control private, no-store. O cliente pode renovar a assinatura pela rota estável. Configurar CORS do storage para PUT, GET e HEAD onde necessário. A assinatura de partes tem limite de 200 requisições por minuto para comportar uma sessão de 150 partes. MinIO recolhe uploads órfãos em 48 h, além da expiração de 24 h da API. Em S3, configurar lifecycle AbortIncompleteMultipartUpload no bucket provisionado.

### Authorization Matrix

| Operação | Anônimo | Dono | Outro autenticado |
|---|---|---|---|
| Iniciar upload | 401 | Cria para seu próprio canal | Cria para seu próprio canal |
| Assinar partes e completar | 401 | Permitido | 404 |
| Consultar status e metadados | 401 | Permitido | 404 |
| Reproduzir, thumbnail, baixar | READY | READY | READY |

### Error Catalog

| HTTP | Código | Condição |
|---|---|---|
| 400 | VALIDATION_ERROR (envelope existente) | UUID, tamanho, título ou sintaxe inválidos. |
| 400 | VIDEO_PART_INVALID | Número fora da sessão ou tamanho de parte inválido. |
| 401 | Guard JWT existente | Token ausente/inválido em rota protegida. |
| 404 | VIDEO_NOT_FOUND | ID ausente, vídeo de outro canal ou mídia pública indisponível. |
| 409 | VIDEO_UPLOAD_INCOMPLETE | Partes ausentes ou inconsistentes. |
| 409 | VIDEO_UPLOAD_STATE | Operação incompatível com a sessão ou estado. |
| 410 | VIDEO_UPLOAD_EXPIRED | Sessão DRAFT expirada. |
| 503 | VIDEO_STORAGE_UNAVAILABLE | Falha transitória no storage. |
| Status ERROR | VIDEO_FORMAT_UNSUPPORTED, VIDEO_PROCESSING_FAILED ou VIDEO_UPLOAD_EXPIRED | Motivo sanitizado na consulta de status. |

### Events/Messages

- Outbox: intenção durável registrada na mesma transação que muda DRAFT para PROCESSING. O dispatcher publica com lease ou trava por registro, confirma publicação após resposta do Redis e reprocessa pendências.
- Queue BullMQ `video-processing`, job `process-video`, payload `{ version: 1, videoId: string }`, jobId igual ao UUID. Worker lê as chaves a partir do banco.
- Três tentativas totais, backoff exponencial inicial de 5 s e concorrência 1. Estado READY só depois de gravar original verificado, playback e thumbnail. Falhas de mídia são permanentes. Jobs finais ficam retidos enquanto houver necessidade de reconciliação.
- Worker interrompido pode ser reentregue pelo BullMQ. Consumidor relembra o estado no banco e evita reprocessar estados terminais. Dispatcher reconcilia PROCESSING com jobs ausentes e falhas terminais. A sessão concluída fora da transação pode ser recuperada por HeadObject antes de nova tentativa de composição. DRAFT expirado sem objeto completo tem multipart abortado e vira ERROR.

## Step Implementations

### SI-03.1 — Persistência de vídeos

**Depends on:** Fases 01 e 02.

**Implementation:** criar migration reversível, entidades, integração ao data source e repositório. Testar FK, estados, unicidade, leitura de tamanho de 10 GB e commit ou rollback conjunto de vídeo/outbox.

### SI-03.2 — Serviços e upload multipart

**Depends on:** SI-03.1.

**Implementation:** adicionar MinIO (build da release oficial fixada) e Redis 7.4.7 persistentes ao Compose, inicializar bucket privado e adicionar clientes com configuração validada. Corrigir MAIL_FROM no exemplo de ambiente para permitir Compose com .env recém-copiado. Criar endpoints de upload e status com OpenAPI. Vincular usuário ao canal. Implementar criação, assinatura, término e limpeza idempotente, com trava por vídeo para mutações de sessão.

**Tests:** autenticação, posse, limites, tamanho assinado, partes ausentes ou divergentes, multipart real, recuperação após composição e confirmação repetida. Validar o teto com casos de fronteira.

### SI-03.3 — Fila durável e worker de mídia

**Depends on:** SI-03.2.

**Implementation:** dispatcher e reconciliador, Redis com AOF e noeviction, processo worker separado no Compose e FFmpeg/ffprobe. Baixar por streams para diretório temporário exclusivo, usar subprocessos sem shell com timeout, extrair metadata, fazer remux faststart e gravar JPEG. Usar multipart para saída acima do limite de PUT simples e liberar temporários ao concluir. Persistir transições e manter logs de IDs e códigos sem expor chaves de acesso.

**Tests:** integração real PostgreSQL/Redis/MinIO, thumbnail, duração, vídeo inválido, retry, deduplicação, resultado terminal e recuperação do dispatcher.

### SI-03.4 — Reprodução e download

**Depends on:** SI-03.3.

**Implementation:** URLs estáveis de mídia e redirects assinados. Diferenciar chave de playback, original e JPEG. Atualizar OpenAPI.

**Tests:** 404 pré-READY, 307 e 206 após seguir o redirect com Range, Content-Range e download fiel com attachment. Confirmar URL estável após renovação.

### SI-03.5 — Aceite e documentação

**Depends on:** SI-03.4.

**Implementation:** executar teste end-to-end com vídeo MP4 real, cenário inválido e fluxo multipart próximo ao teto de 10 GB em execução dedicada. Rodar testes unitários, integração, e2e, TypeScript e lint no Compose. Atualizar os dois AGENTS.md, OpenAPI e progress.md com resultados reais.

## Dependency Map

`Fases 01 e 02 → SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4 → SI-03.5`

## Deliverables

- Migration, módulo de vídeos e worker FFmpeg.
- Compose com PostgreSQL, Mailpit, API, Redis, MinIO e worker.
- Upload direto de até 10 GB, rascunho, processamento automático, thumbnail, metadados, URL única, streaming e download.
- Testes nos níveis requeridos, documentação do Codex e registros de execução.
