---
libs:
  bullmq: "5.66.4"
  "@aws-sdk/client-s3": "3.935.0"
  "@aws-sdk/s3-request-presigner": "3.935.0"
  ffmpeg: "7.1.5"
  minio: "RELEASE.2025-10-15T17-29-55Z"
  redis: "7.4.7"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-16T16:03:14.0305530Z"
---

# Library References

### bullmq

Context7 `/taskforcesh/bullmq/v5.66.4`, TypeScript. Usar `Queue.add` com `jobId` sem dois-pontos, tentativas e backoff exponencial. `Worker` precisa de conexão persistente. Jobs retidos permitem conciliar resultados terminais e resistir a republicações com o mesmo identificador. Redis persistente, com política noeviction. [BullMQ connections](https://docs.bullmq.io/guide/connections) · [Job IDs](https://docs.bullmq.io/guide/jobs/job-ids)

### @aws-sdk/client-s3

Context7 `/aws/aws-sdk-js-v3` e `/websites/aws_amazon_s3`. Disponibilidade da versão 3.935.0 e Node >=18 confirmados no registro npm. Modelos consultados da série v3. Usar CreateMultipartUpload, ListParts, CompleteMultipartUpload, AbortMultipartUpload, HeadObject e GetObject. Completar com os ETags retornados pelo storage, na ordem dos números de parte. Conferir a identidade e o tamanho do objeto após completar e ao recuperar confirmações interrompidas. [AWS SDK v3.935.0](https://github.com/aws/aws-sdk-js-v3/tree/v3.935.0) · [S3 multipart](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)

### @aws-sdk/s3-request-presigner

Versão alinhada à de client-s3 e verificada no registro npm. Usar getSignedUrl para assinar UploadPart e GetObject com o endpoint alcançável pelo cliente. Restringir a assinatura a bucket, chave, upload ID e número da parte. Para download assinar a disposição attachment. [S3 request presigner](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/)

### ffmpeg

Context7 `/websites/ffmpeg_documentation`. Worker usa ffprobe com saída JSON, FFmpeg para extrair um frame e remux sem recodificação com faststart. Debian trixie distribui FFmpeg e ffprobe no pacote `ffmpeg=7:7.1.5-0+deb13u1`. Confirmar a disponibilidade do pacote no build do worker. [Debian trixie](https://packages.debian.org/trixie/ffmpeg) · [ffprobe](https://ffmpeg.org/ffprobe.html) · [MP4 muxer](https://ffmpeg.org/ffmpeg-formats.html#mov_002c-mp4_002c-ismv)

### MinIO e Redis

MinIO Community é distribuído como fonte. As tags consultadas nos registries públicos não estavam acessíveis. O Compose deve compilar a release oficial `RELEASE.2025-10-15T17-29-55Z` em build Docker de múltiplos estágios. A imagem `redis:7.4.7-alpine` foi localizada no registry. [MinIO releases](https://github.com/minio/minio/releases) · [Redis Docker image](https://hub.docker.com/_/redis)
