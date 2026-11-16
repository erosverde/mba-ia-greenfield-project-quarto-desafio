<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

## StreamTube Fase 03

Com o Docker Desktop ativo e `.env` criado a partir de `.env.example`, suba a infraestrutura, instale as dependências, aplique as migrations e inicie o worker. Execute os comandos a partir de `nestjs-project/`.

```sh
docker compose up -d --build db mailpit minio redis nestjs-api
docker compose exec -T nestjs-api npm ci
docker compose exec -T nestjs-api npm run migration:run
docker compose up -d --build video-worker
docker compose exec nestjs-api npm run start:dev
```

O dono do canal inicia um rascunho com `POST /videos/uploads`, enviando `title` e `sizeBytes`. Peça uma URL para cada número de parte com `POST /videos/:id/uploads/parts/:partNumber` e envie a parte por PUT direto para a URL recebida. Use exatamente o `contentLength` informado. `POST /videos/:id/uploads/complete` confirma o multipart e registra o job. Consulte `GET /videos/:id` com JWT para acompanhar o processamento. Quando o vídeo estiver READY, use os caminhos públicos de reprodução, thumbnail e download devolvidos pela API. Para testar um intervalo, siga o 307 com o cabeçalho `Range: bytes=0-1023`. Ative `SWAGGER_ENABLED=true` para consultar o contrato em `/api/docs`.

### Verificação

Crie um banco exclusivo para os testes. As suítes de migrações recriam tabelas nesse banco. Mantenha o worker do Compose apontado para o banco de desenvolvimento.

```sh
docker compose exec -T db createdb -U streamtube streamtube_test
docker compose exec -T -e DB_NAME=streamtube_test -e DB_DATABASE=streamtube_test nestjs-api sh -ec '
  npm run migration:run
  npm test -- --runInBand
  npm run test:e2e -- --runInBand
  npx tsc --noEmit
  npm run lint
'
```

O smoke test transmite um MP4 sintético de 64 MiB + 3 bytes e verifica upload, outbox, worker, estado READY e mídia. Para o aceite de volume, execute o script sem `--smoke` em um ambiente com espaço físico para gravar 10 GB no storage, mais a folga do Docker. O script transmite 150 partes reais, confirma o objeto, verifica o tamanho e lê o último intervalo. Use um banco de teste sem um worker externo apontado para ele.

```sh
docker compose exec -T -e DB_NAME=streamtube_test nestjs-api node --require ts-node/register test/video-limit.acceptance.ts --smoke
```
