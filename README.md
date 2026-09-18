# hackon

Aplikacja Open Mercato **0.7.0**, utworzona z oficjalnego presetu **Classic**.
Zawiera pełny zestaw modułów startera i konfigurację pracy z Codexem (`AGENTS.md`, `.ai/`).

## Wymagania

- Node.js 24 (`nvm use`)
- Yarn 4.17.1 (przez Corepack)
- Docker z Docker Compose

## Pierwsze uruchomienie

```bash
git clone https://github.com/Asignolo/hackon.git
cd hackon
nvm use
corepack enable
yarn install --immutable
cp .env.example .env
```

W `.env` ustaw własne `JWT_SECRET`, `AUTH_SECRET` i `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`.
Dla każdego klucza wygeneruj osobną wartość: `openssl rand -hex 32`.
Ustaw też `POSTGRES_DB=hackon` i nazwę bazy `hackon` w `DATABASE_URL`.
Hasło PostgreSQL musi być takie samo w `POSTGRES_PASSWORD` i `DATABASE_URL`.

```bash
docker compose up -d --wait postgres redis meilisearch
yarn setup
```

`yarn setup` przygotowuje bazę, konta i przykładowe dane, a następnie uruchamia aplikację.
Domyślny adres: <http://localhost:3000>.
Lokalne konto demonstracyjne: `superadmin@acme.com`, hasło `secret`.
To konfiguracja deweloperska; przed udostępnieniem aplikacji zmień dane dostępowe.

## Kolejne uruchomienia

```bash
docker compose up -d --wait postgres redis meilisearch
yarn dev
```

Po sklonowaniu możesz zainstalować umiejętności agenta poleceniem `yarn install-skills`.
Pliki `.env`, zależności, dane usług i wygenerowane pliki pozostają lokalne.

## Porty przy kilku aplikacjach

Jeśli domyślne porty są zajęte, ustaw w `.env` wolne `POSTGRES_PORT`,
`REDIS_PORT` i `MEILISEARCH_PORT`, a następnie dostosuj `DATABASE_URL` oraz
opcjonalne `REDIS_URL`, `MEILISEARCH_HOST` i `MEILISEARCH_API_KEY`.
Port aplikacji ustaw jako `PORT`, a jej adres jako `APP_URL` i `NEXT_PUBLIC_APP_URL`.
Dla ekranu startowego można przekazać `OM_DEV_SPLASH_PORT` przed `yarn dev`.

## Sprawdzenie projektu

```bash
yarn generate
yarn typecheck
yarn lint
yarn ds:check
yarn test --runInBand
yarn build
```
