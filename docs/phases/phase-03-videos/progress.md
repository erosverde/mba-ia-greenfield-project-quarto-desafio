---
kind: phase
name: phase-03-videos
status: in_progress
---

# phase-03-videos — Progress

| SI | Entrega | Status | Testes |
|---|---|---|---|
| SI-03.1 | Persistência de vídeos | completed | Migration e rollback, 6 testes de integração focados, suíte completa (148 testes), e2e (52 testes), tsc e lint dos arquivos alterados passaram. |
| SI-03.2 | Serviços e upload multipart | completed | MinIO e Redis saudáveis no Compose. 4 e2e de upload, 148 testes da suíte, 56 e2e no total, tsc e lint do módulo passaram. |
| SI-03.3 | Fila durável e worker de mídia | completed | 4 testes focados de integração, 152 testes da suíte, 56 e2e, tsc, lint do SI e smoke test no serviço do Compose passaram. |
| SI-03.4 | Reprodução e download | pending | A executar |
| SI-03.5 | Aceite e documentação | pending | A executar |

## Verificação da base

PostgreSQL 17 e Mailpit saudáveis no Compose. Context7 respondeu a consultas e o MCP PostgreSQL respondeu a uma consulta SQL de leitura. O carregamento automático da configuração do projeto segue pendente de verificação em nova sessão. Uma cópia Linux dentro do container foi usada para evitar a lentidão da instalação no bind mount Windows.

A suíte de referência passou após corrigir a limpeza do enum residual de autenticação no teste de migrations. O exemplo de ambiente foi ajustado para que o Compose aceite MAIL_FROM. O lint global retornou 150 erros tanto na cópia de referência da Fase 02 quanto após o SI-03.1. As falhas herdadas seguem abertas para a Definition of Done da fase.

## Verificação do SI-03.2

MinIO compilado da release fixada e Redis respondeu PONG. Os e2e cobrem autorização, tamanho declarado de 10 GB e rejeição acima do limite, CORS, bucket privado, envio de duas partes reais (64 MiB + 3 bytes), validação do tamanho no storage, confirmação concorrente, recuperação pós-composição e expiração. A confirmação deixa o vídeo em PROCESSING com uma intenção na outbox. O teste de transferência no teto de 10 GB permanece no SI-03.5.

## Verificação do SI-03.3

O serviço `video-worker` rodou no Compose com BullMQ 5.66.4, Redis e FFmpeg 7.1.5. O dispatcher publica da outbox com o UUID estável e reconcilia jobs ausentes e falhas terminais. O worker salva JPEG, MP4 faststart e metadados, com até três tentativas para falhas transitórias. O teste de integração usa FFmpeg na imagem de desenvolvimento e serviços reais em banco de teste isolado. Um smoke test no container empacotado processou um MP4 H.264 sem áudio de 1 segundo até READY, com as duas chaves de artefato gravadas.
