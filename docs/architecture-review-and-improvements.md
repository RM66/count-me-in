# CountMeIn — Ревью архитектуры и план улучшений

Документ содержит результаты архитектурного аудита CountMeIn, зафиксированные архитектурные решения, анализ рисков и пошаговый план реализации.

---

## 1. Контекст и целевая архитектура

CountMeIn использует гибридный полиглотный стек на базе Turborepo и единого проекта Vercel:

- **Web & SSR Reads (`apps/web`):** Next.js 16 (App Router), React 19, Tailwind CSS v4, shadcn/ui. Чтение данных для SSR-страниц (кабинет, публичная страница бронирования, лендинг, sitemap, OG) выполняется напрямую из Postgres через Drizzle ORM (`src/server/db/*`). Авторизация организаторов реализована через Auth.js v5 (`@telegram-auth/server` + custom Telegram Credentials provider).
- **API & Writes (Go Serverless Functions внутри `apps/web`):** Vercel Serverless Functions на Go (`net/http`, `pgx/v5`, `go-redis`). Отвечает за все мутирующие операции (создание и отмена бронирований, слотов, сервисов, профиля), валидацию Telegram Login Widget, выдачу auth-тикетов, генерацию presigned URL для Cloudflare R2 и обработку фоновых задач Upstash QStash.
- **Очереди и уведомления:** Upstash QStash вызывает `POST /api/jobs/{queue}` (эндпоинт на Go). Задачи создаются inline после фиксации транзакции бронирования/отмены.
- **Хранилище:** PostgreSQL (основные данные), Redis (одноразовые тикеты, ссылки быстрого входа, сессии), Cloudflare R2 (аватары и обложки услуг).

```mermaid
flowchart TD
    Guest[Гость / Браузер]
    Org[Организатор / Браузер]
    TelegramBot[Telegram Bot API]
    QStash[Upstash QStash]
    R2[Cloudflare R2]
    PG[(Postgres)]
    Redis[(Redis)]

    subgraph Vercel [Vercel Project: Root Directory = apps/web]
        subgraph web_next [Next.js: apps/web/src]
            MW[proxy.ts: Auth Middleware]
            SSR[Server Components: Direct Drizzle Reads]
            AuthRoute[api/auth/nextauth: Auth.js Session Minting]
            ClientUI[React Client Components]
        end

        subgraph web_go [Go Functions: apps/web/api & apps/web/internal]
            GoRouter[API Entry Points: apps/web/api/*]
            GoAuth[Auth: JWE decrypt / Tickets]
            GoDB[pgx/v5 Raw SQL Writes]
            GoStorage[R2 Presigned URLs]
            GoJobs[Jobs Handler: api/jobs/*]
        end
    end

    Guest -->|GET /{orgSlug}| SSR
    SSR -->|Drizzle ORM Reads| PG
    Org -->|GET /cabinet/*| SSR
    Org -->|POST /api/auth/nextauth/*| AuthRoute
    AuthRoute -->|Session JWE cookie| Org

    ClientUI -->|POST/PUT /api/*| GoRouter
    GoRouter --> GoAuth
    GoAuth --> Redis
    GoRouter --> GoDB
    GoDB -->|Atomic UPDATE/INSERT| PG
    GoRouter --> GoStorage
    GoStorage --> R2

    GoDB -->|Publish after commit| QStash
    QStash -->|Signed webhook POST /api/jobs/*| GoJobs
    GoJobs --> TelegramBot
    GoJobs --> PG
    GoJobs --> Redis
```

---

## 2. Зафиксированные архитектурные решения (Architecture Choices)

### Развилка 1: Структура каталогов и топология деплоя на Vercel

**ВЫБРАН: Вариант A (Перенос Go-части внутрь `apps/web` — Полиглотный проект)**

- **Суть решения:** Вся кодовая база Go API (`api/`, `internal/`, `cmd/`, `scripts/`, `go.mod`, `go.sum`, `vercel.json`) переносится внутрь `apps/web/`.
- **Обоснование:**
  - Vercel нативно поддерживает полиглотные проекты: папка `apps/web/api/**/*.go` автоматически компилируется Vercel в Serverless Functions на Go и обслуживается платформой по путям `/api/*`, без необходимости в проксировании или `beforeFiles` rewrites в продакшене.
  - `Root Directory` в Vercel настраивается стандартно: `apps/web`. Vercel из коробки обнаруживает `package.json`, подключает Framework Preset Next.js и интеграцию с Turborepo.
  - Каталог `apps/` полностью очищается от технического мусора Go и содержит только настоящие приложения (`apps/web`, в перспективе `apps/mobile`, `apps/admin`).
  - Bun/Turborepo workspace `"apps/*"` функционирует штатно без ложного сканирования технических папок Go.
  - Единый деплой, единый набор переменных окружения на бесплатном тарифе Vercel Hobby.
- _Отклоненный Вариант B (Изоляция в `apps/api`):_ Требует либо разделения на 2 отдельных проекта Vercel с сетевым проксированием и дублированием `.env`, либо хрупких сборочных скриптов (Vercel Build Output API v3 / pre-build sync) для объединения в один проект.

---

### Развилка 2: Граница между Go API и Next.js SSR

**ВЫБРАН: Вариант B (CQRS-лайт: Next.js читает через Drizzle, Go пишет через pgx)**

- **Суть решения:**
  - **Чтение (Query):** Next.js Server Components напрямую читают Postgres через Drizzle ORM (`apps/web/src/server/db/*`) для быстрого SSR страниц кабинета, публичных витрин и sitemap без промежуточных сетевых вызовов.
  - **Запись (Command):** Все мутирующие операции (бронирования, слоты, услуги, профиль, загрузка медиа, вебхуки QStash) выполняются исключительно через Go API (`apps/web/internal/db/*`).
  - В Next.js запрещены любые мутации (INSERT/UPDATE/DELETE), что контролируется линтером и тестами.
  - Контракты данных синхронизируются через валидационный скрипт проверки дрифта в CI.
- **Обоснование:**
  - Обеспечивает минимальное время TTFB (Time to First Byte) для пользователей: Server Components не тратят время на HTTP-запросы внутри serverless-контейнеров Vercel.
  - Высоконагруженные и конкурентные операции (атомарное резервирование мест, транзакции отмены, HMAC-проверка Telegram) изолированы в быстром и эффективном Go-рантайме.
- _Отклоненный Вариант A (Полная консолидация на Go):_ Потребовал бы добавления HTTP-хопов из Next.js SSR в Go API на каждый просмотр страницы, увеличивая время рендеринга и создавая двойную нагрузку на serverless-инфраструктуру.

---

### Развилка 3: Модель синхронизации данных на клиенте

**ВЫБРАН: Вариант B (Server-Driven UI через Server Components, router.refresh() и Optimistic UI)**

- **Суть решения:**
  - Server Components остаются единственным источником правды для состояния данных в кабинете.
  - Из `apps/web/src/api-client/` удаляются фиктивные инвалидации `invalidateQueries` для сущностей, не имеющих клиентского кэша.
  - Формы и кнопки действий используют `useTransition` и вызов `router.refresh()` после успешных мутаций, гарантируя консистентную перерисовку серверного дерева компонентов.
  - Для улучшения UX применяются локальные optimistic states (например, мгновенная блокировка удаляемого слота или отменяемой брони до завершения сетевого запроса).
- **Обоснование:**
  - Избавляет клиентский бандл от лишнего состояния и двойного кэширования.
  - Исключает рассинхронизацию между кэшем TanStack Query и серверным HTML.
  - Соответствует идиоматической архитектуре Next.js App Router.
- _Отклоненный Вариант A (Полноценный TanStack Query с гидратацией):_ Потребовал бы дублирования всех read-методов в виде REST GET-эндпоинтов в Go API, настройки дегидратации на сервере и утяжеления клиентского бандла.

---

## 3. Выявленные проблемы и технический долг

### Критические (Critical)

1. **Загрязнение каталога `apps/` и нарушение семантики монорепозитория:**
   Нахождение `internal/`, `cmd/`, `scripts/`, `go.mod`, `vercel.json` в корне `apps/` конфликтует с `"workspaces": ["apps/*"]`. В `apps/` отсутствует `package.json`, что делает сборку в корне `apps/` некорректной для стандартных механизмов Vercel.
2. **Полное отсутствие Rate Limiting на публичных эндпоинтах:**
   Эндпоинты `POST /api/auth/telegram-guest`, `POST /api/auth/telegram-signup`, `POST /api/bookings` и `POST /api/organizers/me/service-photo` не защищены от флуда и брутфорса, создавая угрозу исчерпания ресурсов Redis, Cloudflare R2 и Telegram Bot API.
3. **Синхронная последовательная публикация в QStash:**
   В `apps/web/internal/routes/bookings.go` после фиксации транзакции бронирования выполняются **два последовательных HTTP-запроса** к QStash. Это добавляет до 300–500 мс задержки в ответ гостю и может удерживать соединение до 3 секунд при сетевых сбоях.
4. **Хрупкая расшифровка Auth.js JWE токенов в Go:**
   В Go API реализован ручной парсер внутреннего формата `@auth/core` JWE A256CBC-HS512. Минорное изменение формата в Auth.js приведет к мгновенной потере авторизации всеми организаторами (`401 Unauthorized`).
5. **Каскадное удаление данных и отсутствие блокировок слотов:**
   В `packages/db/src/schema.ts` внешние ключи `time_slots.service_id` и `bookings.time_slot_id` содержат правило `onDelete: 'cascade'`. При вызове `DELETE /api/slots/:id` слот удаляется вместе со всеми записями гостей без уведомлений и фиксации отмен.

### Высокий приоритет (High)

6. **O(N) нагрузка на память при чтении бронирований и аналитики:**
   Функция `listBookings(organizerId)` в `apps/web/src/server/db/booking.ts` запрашивает все бронирования за все время существования аккаунта. В `computeAnalytics` весь этот массив обрабатывается в памяти JS. При росте базы это приведет к падению Node.js функции по памяти.
7. **Угроза исчерпания пула соединений PostgreSQL (Connection Pool Exhaustion):**
   Next.js (`packages/db/src/client.ts`) открывает пул `postgres.js` (до 10 соединений на инстанс). Go API (`internal/db/client.go`) создает пул `pgxpool` до 5 соединений. В serverless-среде при всплеске трафика суммарное число соединений превысит лимит базы данных.
8. **Мертвый пакет `@repo/media-storage`:**
   После переноса генерации подписанных URL для R2 в Go API, пакет `packages/media-storage` остался заброшенным.
9. **Нефорсированная граница чтения/записи между Next.js и Go API:**
   Инвариант «чтения в Next.js, записи в Go» не защищен инструментально. Server Action `setLocale` в `apps/web/src/i18n/actions.ts` выполняет прямую мутацию базы `updateOrganizerLanguage` в обход Go API.

### Средний приоритет (Medium)

10. **Имитация TanStack Query в кабинете:**
    В `apps/web/src/api-client/` TanStack Query используется лишь как обертка вокруг `fetch` в `useMutation`. Вызовы `invalidateQueries` не привязаны к активным кэшам.
11. **Небезопасное извлечение параметров пути в Go API:**
    В `internal/httpx/middleware.go` функция `PathParam(r, prefix)` отсекает строку по длине префикса без проверки `strings.HasPrefix`.
12. **HTTP 500 вместо HTTP 400 при пустом теле обновления профиля:**
    В `internal/routes/organizers.go` пустой payload обновления профиля возвращает статус 500 из-за исторической совместимости с поведением Drizzle.

---

## 4. Пошаговый план реализации (Action Plan)

### Фаза 0. Реализация Развилки 1 (Вариант A: Перенос Go-части внутрь `apps/web`)

Цель: восстановить чистоту монорепозитория, избавиться от посторонних папок в `apps/` и подготовить проект к единому нативному деплою на Vercel.

#### Шаг 0.1. Перемещение файлов Go API внутрь `apps/web`

- **Действия:**
  1. Переместить структуру Go API внутрь `apps/web/`:
     ```sh
     mv apps/api apps/web/api
     mv apps/internal apps/web/internal
     mv apps/cmd apps/web/cmd
     mv apps/scripts apps/web/scripts/go
     mv apps/go.mod apps/web/go.mod
     mv apps/go.sum apps/web/go.sum
     mv apps/vercel.json apps/web/vercel.json
     ```
  2. Удалить временный `apps/README.md`, объединив полезную информацию с `apps/web/README.md`.
  3. Убедиться, что в каталоге `apps/` осталась только папка `apps/web`.
- **Файлы:**
  - `apps/` (очистка)
  - `apps/web/` (целевая структура)

#### Шаг 0.2. Корректировка путей и скриптов сборки

- **Действия:**
  1. В `apps/web/package.json` обновить скрипты:
     ```json
     "dev": "concurrently -n web,api -c blue,green \"next dev --port 3000\" \"go run ./cmd/dev\"",
     "check:api-routes": "bun scripts/check-api-routes.ts",
     "build:go": "sh scripts/go/build.sh"
     ```
  2. В `apps/web/scripts/check-api-routes.ts` изменить вычисление пути к директории API:
     ```ts
     const goApiDir = join(fileURLToPath(import.meta.url), '..', '..', 'api')
     ```
  3. В `apps/web/scripts/go/build.sh` проверить пути к исходникам (`./internal/...`, `./cmd/...`, `api/`).
  4. В `apps/web/scripts/go/check-translations.sh` и `sync-translations.sh` обновить относительные пути к `../../packages/translations` (скрипты выполняют `cd "$(dirname "$0")/.."` — переход в `apps/web/` — перед обращением к `packages/`).
- **Файлы:**
  - `apps/web/package.json`
  - `apps/web/scripts/check-api-routes.ts`
  - `apps/web/scripts/go/build.sh`
  - `apps/web/scripts/go/check-translations.sh`
  - `apps/web/scripts/go/sync-translations.sh`

#### Шаг 0.3. Обновление CI и конфигурации Vercel

- **Действия:**
  1. В `.github/workflows/ci.yml` обновить задачу `go-api`:
     ```yaml
     - name: Build, vet, test, check translations
       working-directory: apps/web
       run: sh scripts/go/build.sh
     ```
  2. В дашборде проекта Vercel установить **Root Directory**: `apps/web`.
  3. В `apps/web/scripts/api-rewrites.mjs` зафиксировать: в режиме `production` rewrites пустые (`{ beforeFiles: [] }`), так как Vercel маршрутизирует `/api/*` напрямую в Go Serverless Functions.
- **Файлы:**
  - `.github/workflows/ci.yml`
  - `apps/web/scripts/api-rewrites.mjs`

---

### Фаза 1. Безопасность и защита данных

#### Шаг 1.1. Внедрение Rate Limiting в Go API

- **Задача:** Защитить публичные маршруты от флуда и исчерпания квот через Redis.
- **Действия:**
  1. Создать middleware `apps/web/internal/httpx/ratelimit.go` на базе sliding window в Redis.
  2. Подключить ограничения:
     - `POST /api/auth/telegram-guest`: 10 req/min на IP.
     - `POST /api/auth/telegram-signup`: 5 req/min на IP.
     - `POST /api/bookings`: 5 req/min на IP / Telegram ID.
     - `POST /api/organizers/me/avatar` и `service-photo`: 10 req/hour на Organizer ID.
  3. При превышении возвращать HTTP 429 (`TooManyRequests`) с заголовком `Retry-After`.
- **Файлы:**
  - `apps/web/internal/httpx/ratelimit.go` (новый)
  - `apps/web/internal/routes/auth.go`
  - `apps/web/internal/routes/bookings.go`
  - `apps/web/internal/routes/organizers.go`

#### Шаг 1.2. Защита от потери бронирований при удалении слота

- **Задача:** Предотвратить случайное каскадное удаление подтвержденных записей гостей.
- **Действия:**
  1. В `packages/db/src/schema.ts` изменить поведение внешнего ключа `bookings.timeSlotId` на `onDelete: 'restrict'`.
  2. Сгенерировать миграцию Drizzle (`bun run db:generate`).
  3. В `apps/web/internal/db/timeslot.go` при вызове `DeleteOwnedSlot` проверять наличие подтвержденных записей (`booked_count > 0` или `status = 'confirmed'`). Если записи есть, возвращать ошибку `SlotHasActiveBookingsError`.
  4. В `apps/web/internal/routes/slots.go` мапить ошибку в HTTP 409 Conflict.
  5. В UI кабинета (`use-slots-table.ts`) блокировать прямое удаление слота с активными бронями, предлагая организатору сначала отменить их.
- **Файлы:**
  - `packages/db/src/schema.ts`
  - `packages/db/drizzle/*`
  - `apps/web/internal/db/timeslot.go`
  - `apps/web/internal/routes/slots.go`
  - `apps/web/src/app/cabinet/slots/_components/use-slots-table.ts`

---

### Фаза 2. Реализация Развилки 3 (Вариант B: Оптимизация производительности и Server-Driven UI)

#### Шаг 2.1. Параллелизация и неблокирующая публикация в QStash

- **Задача:** Устранить задержку ответа гостю при бронировании.
- **Действия:**
  1. В `apps/web/internal/queue/qstash.go` переписать `PublishBookingCreated` на параллельную отправку задач организатору и гостю через `golang.org/x/sync/errgroup` или `sync.WaitGroup`.
  2. В `apps/web/internal/httpx/response.go` добавить вызов `http.Flusher`: сбрасывать тело `201 Created` в сетевой сокет до ожидания ответа от QStash.
  3. Сократить таймаут контекста публикации с 3 до 1.5 секунд.
- **Файлы:**
  - `apps/web/internal/queue/qstash.go`
  - `apps/web/internal/httpx/response.go`
  - `apps/web/internal/routes/bookings.go`

#### Шаг 2.2. SQL-агрегация аналитики и пагинация в Кабинете

- **Задача:** Устранить загрузку всего массива бронирований в память Node.js.
- **Действия:**
  1. В `apps/web/src/server/db/booking.ts`:
     - Добавить пагинацию в `listBookings(organizerId, { limit, offset, status })` (по умолчанию limit = 50).
     - Реализовать функцию `getAnalyticsSummary(organizerId)` с прямым SQL-запросом, выполняющим расчет метрик на стороне PostgreSQL (`COUNT(*) FILTER ...`, `SUM(seats) FILTER ...`, `date_trunc('day', created_at)`).
  2. Переписать `apps/web/src/app/cabinet/analytics/page.tsx`: вызывать `getAnalyticsSummary` вместо in-memory расчета в `computeAnalytics`.
  3. В `apps/web/src/app/cabinet/bookings/page.tsx` и `bookings-table.tsx` реализовать пагинацию страниц.
- **Файлы:**
  - `apps/web/src/server/db/booking.ts`
  - `apps/web/src/app/cabinet/analytics/page.tsx`
  - `apps/web/src/app/cabinet/analytics/compute-analytics.ts`
  - `apps/web/src/app/cabinet/bookings/page.tsx`
  - `apps/web/src/app/cabinet/bookings/_components/bookings-table.tsx`

#### Шаг 2.3. Очистка клиентского слоя данных и внедрение Optimistic UI

- **Задача:** Убрать фиктивное кэширование TanStack Query и обеспечить плавный отклик интерфейса.
- **Действия:**
  1. В `apps/web/src/api-client/service.ts`, `time-slot.ts`, `booking.ts` удалить неработающие вызовы `queryClient.invalidateQueries` для сущностей без клиентских `useQuery`.
  2. В хуках форм (`use-service-form.ts`, `use-slot-form.ts`) обернуть переходы и обновление данных в `useTransition` + `router.refresh()`.
  3. В таблицах слотов и бронирований добавить optimistic-состояния (визуальное приглушение строки при удалении/отмене до завершения запроса).
- **Файлы:**
  - `apps/web/src/api-client/service.ts`
  - `apps/web/src/api-client/time-slot.ts`
  - `apps/web/src/api-client/booking.ts`
  - `apps/web/src/app/cabinet/services/_components/use-service-form.ts`
  - `apps/web/src/app/cabinet/slots/_components/use-slot-form.ts`

#### Шаг 2.4. Защита пула соединений PostgreSQL

- **Задача:** Предотвратить исчерпание лимита соединений к базе в Serverless.
- **Действия:**
  1. В `packages/db/src/client.ts` ограничить максимальное количество соединений `postgres(connectionString, { max: 1, idle_timeout: 20 })` для serverless-окружения и сохранять инстанс в `globalThis` в dev-режиме.
  2. Убедиться, что `POSTGRES_URL` в продакшене использует транзакционный режим пулера (Supavisor порт 6543 или Neon pooled connection).
- **Файлы:**
  - `packages/db/src/client.ts`
  - `apps/web/internal/db/client.go`

---

### Фаза 3. Реализация Развилки 2 (Вариант B: Укрепление границы CQRS-лайт)

#### Шаг 3.1. Инструментальная защита границы чтения/записи (Линт-правило)

- **Задача:** Гарантировать, что слой `apps/web/src/server/db/*` используется строго для чтения данных.
- **Действия:**
  1. В `apps/web/eslint.config.js` добавить правило `no-restricted-syntax`, запрещающее вызовы мутирующих методов Drizzle (`.insert(`, `.update(`, `.delete(`, `.set(`) в каталоге `src/server/db/**/*.ts`.
  2. Подключить проверку в задачу CI `bun run lint`.
- **Файлы:**
  - `apps/web/eslint.config.js`

#### Шаг 3.2. Перенос `updateOrganizerLanguage` в Go API

- **Задача:** Ликвидировать последнюю оставшуюся мутацию на стороне Next.js.
- **Действия:**
  1. Добавить эндпоинт `PATCH /api/organizers/me/language` в `apps/web/api/organizers/me/language/index.go` и логику в `apps/web/internal/routes/organizers.go` + `apps/web/internal/db/organizer.go`.
  2. В `apps/web/src/i18n/actions.ts` заменить прямой вызов `updateOrganizerLanguage` на вызов нового эндпоинта.
  3. Удалить write-функцию из `apps/web/src/server/db/organizer.ts`.
- **Файлы:**
  - `apps/web/api/organizers/me/language/index.go` (новый)
  - `apps/web/internal/routes/organizers.go`
  - `apps/web/internal/db/organizer.go`
  - `apps/web/src/i18n/actions.ts`
  - `apps/web/src/server/db/organizer.ts`

#### Шаг 3.3. Автоматический тест синхронизации контрактов в CI

> Реализовано иначе (сентябрь 2026, ADR-014): вместо отдельного `scripts/check-contracts.ts` — wire-реестр (`packages/contracts/src/wire.ts`) как манифест, guards внутри `scripts/generate-contracts.ts`, кросс-языковые векторы (`packages/contracts/vectors/`) и golden-тесты, плюс проверка свежести через `git diff --exit-code` в CI.

- **Задача:** Предотвратить рассинхронизацию TypeScript Zod-схем и Go-структур валидации.
- **Действия:**
  1. Написать скрипт `scripts/check-contracts.ts`, проверяющий совпадение имен полей и правил валидации между `packages/contracts` и `apps/web/internal/contracts`.
  2. Подключить шаг проверки в `.github/workflows/ci.yml`.
- **Файлы:**
  - `scripts/check-contracts.ts` (новый)
  - `.github/workflows/ci.yml`

#### Шаг 3.4. Документирование границы CQRS в ADR-013

- **Задача:** Явно зафиксировать архитектурный инвариант в документации проекта.
- **Действия:**
  1. В `docs/decisions/013-api-go-rewrite.md` актуализировать описание топологии (Go внутри `apps/web`) и зафиксировать разделение: все мутации — в Go API, все чтения — в Next.js через Drizzle.
- **Файлы:**
  - `docs/decisions/013-api-go-rewrite.md`
  - `AGENTS.md`

---

### Фаза 4. Устранение технического долга и исправление дефектов

#### Шаг 4.1. Удаление мертвого пакета `packages/media-storage`

- **Задача:** Удалить неиспользуемый код и очистить зависимости.
- **Действия:**
  1. Удалить каталог `packages/media-storage`.
  2. Удалить алиас `@repo/media-storage` из `apps/web/vitest.config.ts`.
  3. Обновить `bun.lock`.
- **Файлы:**
  - `packages/media-storage/` (удаление)
  - `apps/web/vitest.config.ts`

#### Шаг 4.2. Исправление дефектов в HTTP-слое Go API

- **Задача:** Устранить мелкие баги в обработке входящих запросов.
- **Действия:**
  1. В `apps/web/internal/httpx/middleware.go` в функции `PathParam` добавить строгую проверку префикса:
     ```go
     if !strings.HasPrefix(r.URL.Path, prefix) {
         return ""
     }
     rest := r.URL.Path[len(prefix):]
     ```
  2. В `apps/web/internal/routes/organizers.go` возвращать `400 Bad Request` при передаче пустого объекта обновлений профиля.
- **Файлы:**
  - `apps/web/internal/httpx/middleware.go`
  - `apps/web/internal/routes/organizers.go`

---

## 5. Чек-лист готовности и метрики успеха

- [ ] **Фаза 0:** Каталог `apps/` очищен, Go API перенесен внутрь `apps/web/`, Vercel Root Directory настроен на `apps/web`.
- [ ] **Фаза 1:** Rate limiting активен и подтвержден тестами в Go API.
- [ ] **Фаза 1:** Каскадное удаление слота с активными бронированиями блокируется на уровне БД и API (HTTP 409).
- [ ] **Фаза 2:** Время ответа `POST /api/bookings` сократилось на 150–300 мс за счет параллельного QStash и `http.Flusher`.
- [ ] **Фаза 2:** Время SSR страницы `/cabinet/analytics` стабильно (< 100 мс) независимо от объема исторических данных за счет SQL-агрегации.
- [ ] **Фаза 2:** Из `apps/web/src/api-client/` удалены неиспользуемые инвалидации TanStack Query; формы используют `useTransition`.
- [ ] **Фаза 3:** В `src/server/db/` отсутствуют write-операции (подтверждено ESLint-правилом в CI).
- [ ] **Фаза 3:** Операция `updateOrganizerLanguage` перенесена в Go API (`PATCH /api/organizers/me/language`).
- [ ] **Фаза 3:** В CI выполняется автоматическая проверка отсутствия дрифта контрактов.
- [ ] **Фаза 4:** Удален пакет `packages/media-storage`, исправлены `PathParam` и валидация пустого профиля.
