# Backend StreamTube

Leia CLAUDE.md neste diretório para setup, execução e testes. Leia as regras aplicáveis em ../.claude/rules/ antes de editar. Use as regras nestjs-* para camadas, DTOs, módulos, entidades e testes, as regras typeorm-* para persistência e migrações, e auth-jwt.md e typescript-strict.md quando aplicáveis.

A Fase 03 é backend. Use docs/phases/phase-02-auth como referência para os artefatos da fase. Antes de implementar, verifique o baseline no Compose. Registre os testes de cada SI no progress.md e execute a suíte completa, e2e, tsc e lint para fechar a fase.

## Vídeos da Fase 03

- `POST /videos/uploads`, `POST /videos/:id/uploads/parts/:partNumber` e `POST /videos/:id/uploads/complete` usam JWT e o canal do dono. As URLs pré-assinadas recebem os bytes diretamente no MinIO/S3. O limite é 10.000.000.000 bytes.
- `GET /videos/:id` mostra ao dono o estado DRAFT, PROCESSING, READY ou ERROR. Os endpoints públicos `/videos/:id/stream`, `/videos/:id/thumbnail` e `/videos/:id/download` respondem com redirecionamentos 307 para mídia READY. O storage resolve HTTP Range e o download serve o original como attachment.
- O serviço `video-worker` executa o dispatcher PostgreSQL e o consumidor BullMQ. Redis persiste a fila. O worker tem concorrência inicial 1, extrai duração e metadados com ffprobe, gera JPEG e prepara playback MP4/H.264 com áudio AAC opcional. Garanta espaço temporário para o original e a saída.
- MinIO usa o endpoint interno `http://minio:9000`. `VIDEO_STORAGE_PUBLIC_ENDPOINT` define o endereço que o cliente recebe nas assinaturas e vale `http://localhost:9000` no Compose local.
- Use um banco isolado para as suítes, com `DB_NAME` e `DB_DATABASE` apontando para ele. A imagem de desenvolvimento inclui FFmpeg para os testes. O procedimento de aceite está no [README](README.md#streamtube-fase-03).
