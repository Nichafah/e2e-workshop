# Lab — E2E Exercise: ผู้มีสิทธิลงทะเบียนแล้วเห็นรายชื่อผู้สมัคร

**Reference:** [Playwright — API testing](https://playwright.dev/docs/api-testing) · Fowler — [Testing Strategies in a Microservice Architecture](https://martinfowler.com/articles/microservice-testing/) (End-to-end tests)
**เวลา:** ~90 นาที

## เป้าหมาย

เขียน **end-to-end (e2e) test** แบบ automation ตั้งแต่ต้นจนจบ ด้วย Playwright ที่คุยกับ election backend ผ่าน **HTTP เท่านั้น** (black box) ไม่ import โค้ดใน `app/src` เลย

เมื่อจบ lab นี้ เราจะทำได้ครบวงจร:

```
start dependencies + inject test data → start SUT → run Playwright tests → stop SUT + dependencies
```

## 0. เตรียมตัว

```bash
git fetch --all
git switch jest/lab/e2e-exercise-test
docker info                      # Docker ต้องเปิดอยู่
```

> ไม่ต้อง `npm install` ใน `app/`: SUT ถูก build เป็น Docker image (`npm ci` ทำใน image เอง) และ npm scripts ที่ใช้ใน lab นี้เรียกแค่ `docker compose`

> port `3000` (SUT) และ `5434` (database ของ e2e) ต้องว่าง: ถ้ามี `npm run dev` ค้างอยู่ให้ปิดก่อน

---

## 1. ระบบที่จะทดสอบ: Election Backend API

Election backend เป็น **Express JSON API** (TypeScript) ที่เก็บข้อมูลใน **PostgreSQL** มีผู้ใช้ 3 role:

| Role | ทำอะไรได้ |
| --- | --- |
| `VOTER` (ผู้มีสิทธิเลือกตั้ง) | ลงทะเบียนเอง, ดูรายชื่อผู้สมัครในเขตตัวเอง, ลงคะแนน/เปลี่ยนคะแนน |
| `COMMISSIONER` (กกต.) | สร้างพรรค, เพิ่มผู้สมัครในเขต |
| `ADMIN` | เปลี่ยน role ของผู้ใช้ (seed ไว้ใน database เท่านั้น) |

## 2. Test scenarios ที่เป็นไปได้

e2e test ควรเป็น **user journey** ที่มีคุณค่าทางธุรกิจ ไม่ใช่ทดสอบทุก validation (อันนั้นเป็นหน้าที่ของ unit / component test) ตัวอย่าง scenarios:

| # | Scenario (journey) | Actor | Endpoints ที่เกี่ยวข้อง |
| --- | --- | --- | --- |
| S1 | **ผู้มีสิทธิลงทะเบียน แล้วเห็นรายชื่อผู้สมัครในเขตตัวเอง** ⭐ (lab นี้) | VOTER | `POST /auth/register` → `POST /auth/login` → `GET /me/candidates` |
| S2 | กกต. สร้างพรรคและเพิ่มผู้สมัครในเขต แล้วประชาชนเห็นพรรคนั้น | COMMISSIONER | `POST /auth/login` → `POST /parties` → `POST /districts/:id/candidates` → `GET /parties/:id` |
| S3 | ผู้มีสิทธิลงคะแนน แล้วเห็นว่าผู้สมัครที่เลือกถูก `selected` | VOTER | `PUT /me/vote` → `GET /me/candidates` |
| S4 | ผู้มีสิทธิเปลี่ยนใจ ลงคะแนนใหม่ (`201` ครั้งแรก, `200` + `changed: true` ครั้งที่สอง) | VOTER | `PUT /me/vote` ×2 |
| S5 | Admin แต่งตั้งผู้ใช้เป็น กกต. แล้วผู้ใช้นั้นสร้างพรรคได้ | ADMIN, COMMISSIONER | `PATCH /admin/users/:id/role` → `POST /parties` |
| S6 | ประชาชนดูผลของเขต (ก่อนปิดหีบ `closed: false` ไม่มีคะแนน) | Public | `GET /districts/:id/results` |
| S7 | Unhappy paths ที่ผู้ใช้เจอจริง: ลงทะเบียนเลขบัตรซ้ำ `409`, ไม่มี token `401`, voter สร้างพรรค `403`, เลือกผู้สมัครนอกเขต `403` | ทุก role | หลาย endpoint |

### Sequence diagram — S1 (scenario ของ lab นี้)

```mermaid
sequenceDiagram
    autonumber
    actor V as Voter (Playwright test)
    participant API as Election API (SUT)
    participant DB as PostgreSQL

    V->>API: POST /auth/register {nationalId, password, ..., districtId: "CM-2"}
    API->>DB: INSERT INTO users (role = VOTER)
    DB-->>API: new user row
    API-->>V: 201 {id, nationalId, ..., role: "VOTER"} (ไม่มี passwordHash)

    V->>API: POST /auth/login {nationalId, password}
    API->>DB: SELECT user BY national_id
    API-->>V: 200 {token} (JWT: userId, role, districtId)

    V->>API: GET /me/candidates<br/>Authorization: Bearer <token>
    API->>DB: SELECT candidates WHERE district_id = 'CM-2'
    DB-->>API: candidates + parties
    API-->>V: 200 [{id, number, name, party, selected: false}, ...]
```

### Sequence diagram — S2 + S3 (กกต. เตรียมข้อมูล แล้ว voter ลงคะแนน)

```mermaid
sequenceDiagram
    autonumber
    actor C as Commissioner
    actor V as Voter
    participant API as Election API (SUT)
    participant DB as PostgreSQL

    C->>API: POST /auth/login
    API-->>C: 200 {token}
    C->>API: POST /parties {name, policy}<br/>Authorization: Bearer <commissioner token>
    API->>DB: INSERT INTO parties
    API-->>C: 201 {id, name, logoUrl, policy}
    C->>API: POST /districts/CM-2/candidates {partyId, number, firstName, lastName}
    API->>DB: INSERT INTO candidates
    API-->>C: 201 {id, districtId, partyName, ...}

    V->>API: PUT /me/vote {candidateId}<br/>Authorization: Bearer <voter token>
    API->>DB: SELECT election, candidate → INSERT INTO votes
    API-->>V: 201 {candidateId, changed: false, votedAt}
    V->>API: GET /me/candidates
    API-->>V: 200 [..., {id: candidateId, selected: true}, ...]
```

### Sequence diagram — S7 (ตัวอย่าง unhappy path)

```mermaid
sequenceDiagram
    autonumber
    actor V as Voter
    participant API as Election API (SUT)

    V->>API: GET /me/candidates (ไม่มี Authorization header)
    API-->>V: 401 {"error": "authentication required"}
    V->>API: POST /parties<br/>Authorization: Bearer <voter token>
    API-->>V: 403 {"error": "forbidden"}
    V->>API: POST /auth/register (nationalId ที่ลงทะเบียนแล้ว)
    API-->>V: 409 {"error": "national id already registered"}
```

> ลองวาด sequence diagram ของ S4 และ S5 เอง ก่อนลงมือเขียน test ของมัน

## 3. API spec

spec ฉบับเต็ม (request/response จริงทุก endpoint): [`labs/06-outside-in/API.md`](../06-outside-in/API.md)

- Base URL: `http://localhost:3000`
- ทุก request ที่มี body ต้องส่ง `Content-Type: application/json` (Playwright ใส่ให้เองเมื่อใช้ option `data`)
- route ที่ต้อง login ใช้ header `Authorization: Bearer <token>` จาก `POST /auth/login`
- error ทุกตัวมี body เป็น `{ "error": "<message>" }`

| Method | Path | Auth | Success |
| --- | --- | --- | --- |
| GET | `/health` | Public | 200 `{"status":"ok"}` |
| POST | `/auth/register` | Public | 201 user |
| POST | `/auth/login` | Public | 200 `{token}` |
| PATCH | `/admin/users/:id/role` | ADMIN | 200 user |
| GET | `/districts` | Public | 200 districts |
| GET | `/parties` | Public | 200 parties |
| GET | `/parties/:id` | Public | 200 party with candidates |
| POST | `/parties` | COMMISSIONER | 201 party |
| POST | `/districts/:id/candidates` | COMMISSIONER | 201 candidate |
| GET | `/districts/:id/results` | Public | 200 results |
| GET | `/me/candidates` | Any signed-in user | 200 ballot |
| PUT | `/me/vote` | VOTER | 201 first vote, 200 changed vote |

endpoint ที่ lab นี้ใช้:

**`POST /auth/register`** → `201`

```jsonc
// request
{ "nationalId": "1103700012346", "password": "voter1234", "firstName": "Somchai",
  "lastName": "Jaidee", "address": "1 Nimman Rd", "districtId": "CM-1" }
// response
{ "id": 3, "nationalId": "1103700012346", "firstName": "Somchai", "lastName": "Jaidee",
  "address": "1 Nimman Rd", "districtId": "CM-1", "role": "VOTER" }
```

error: `400 invalid national id` (checksum ผิด), `400 password must be at least 8 characters`, `400 unknown district`, `409 national id already registered`

**`POST /auth/login`** → `200 { "token": "<JWT>" }` · error: `401 invalid national id or password`

**`GET /me/candidates`** (ต้องมี token) → `200` รายชื่อผู้สมัครใน **เขตของ token** เรียงตามหมายเลข

```json
[
  { "id": 1, "number": 1, "name": "Anan Srisuk", "party": "Green Lanna", "selected": false },
  { "id": 2, "number": 2, "name": "Malee Wongkham", "party": "Ping River", "selected": true }
]
```

## 4. SUT และ Dependencies

- **SUT (System Under Test):** election backend ทั้งตัว รันใน Docker container (`app` service ใน `app/docker-compose.yml`, build จาก `app/Dockerfile`)
- **Dependencies:**
  - **PostgreSQL** (`db-e2e` service, port `5434`) — database ของ e2e เท่านั้น ใช้ `tmpfs` จึงว่างเปล่าทุกครั้งที่ start ใหม่
  - **Liquibase** (`liquibase` service) — สร้าง schema และ inject ข้อมูลทั้งหมดในครั้งเดียว:
    - reference data (districts) — ไม่มี context รันทุก environment
    - seed ของ e2e (admin, กกต., เปิดการเลือกตั้ง) — `901-e2e-seed.sql`, context `e2e`
    - **test data ของ lab นี้** (พรรค 2 พรรค + ผู้สมัคร 2 คนในเขต `CM-2`) — `902-e2e-exercise-seed.sql`, context `e2e-exercise`
- **Test runner:** Playwright (`e2e-exercise/`) — อยู่ **นอก** SUT และรู้จัก SUT แค่ทาง HTTP

```mermaid
flowchart LR
    subgraph host["เครื่องเรา (host)"]
        PW["Playwright test runner<br/>e2e-exercise/"]
    end

    subgraph docker["Docker Compose (project: election)"]
        APP["app — SUT<br/>Election API<br/>:3000"]
        DB[("db-e2e<br/>PostgreSQL 17<br/>:5434 → 5432")]
        LB["liquibase<br/>(run once)<br/>contexts: e2e, e2e-exercise"]
    end

    PW -- "HTTP / JSON<br/>localhost:3000" --> APP
    APP -- "SQL (pg)<br/>DATABASE_URL" --> DB
    LB -- "schema + seed + test data" --> DB
```

ลำดับการ start สำคัญ: **database → schema (Liquibase) → test data → SUT → tests** และ stop กลับกัน

> ทำไมไม่ใช้ `npm run dev`? เพราะ e2e test ควรทดสอบ **สิ่งเดียวกับที่จะ deploy จริง** คือ Docker image ไม่ใช่โค้ดที่รันผ่าน `tsx` บนเครื่องเรา

---

## 5. Exercise ทีละขั้น

คำสั่งใน Step 1, 2, 6 รันใน `app/` · คำสั่งใน Step 3–5 รันใน `e2e-exercise/`

> ⚠️ ทั้ง `app/` และ `e2e-exercise/` มี `npm test` ถ้าอยู่ผิด directory จะ **ไม่ error** แต่รันผิด test (`app/` = Jest, `e2e-exercise/` = Playwright) ดู 📂 ใต้หัวข้อแต่ละ Step ก่อนพิมพ์คำสั่ง และเช็กด้วย `pwd` ได้

### Step 1 — Start dependencies และ inject test data · 10 นาที

📂 `app/` (เริ่มจาก root ของ repo)

```bash
cd app

# 1.1 start PostgreSQL ของ e2e (--force-recreate = ได้ database ว่างใหม่ทุกครั้ง, --wait = รอจน healthy)
docker compose up -d --force-recreate --wait db-e2e

# 1.2 สร้าง schema + seed + inject test data ด้วย Liquibase (contexts: e2e, e2e-exercise)
npm run db:migrate:e2e-exercise
```

> Step 1 คือรากฐานของ **repeatable test**: ทุกครั้งที่เริ่มวงจร เราได้ database ว่าง แล้วใส่ schema + test data ชุดเดิมเป๊ะ
> test จึงเจอสภาพแวดล้อมเหมือนเดิมทุกครั้ง (ดู 4.0)

test data อยู่ใน `app/db/changelog/changes/902-e2e-exercise-seed.sql` เป็น changeset ปกติของ Liquibase:

```sql
--changeset election:902-seed-e2e-exercise-parties context:e2e-exercise
INSERT INTO parties (name, logo_url, policy) VALUES
    ('พรรคดอยสุเทพ', NULL, 'รถแดงไฟฟ้าทุกสาย'),
    ('พรรคแม่ปิง',   NULL, 'ฝุ่น PM2.5 ต้องหมดในหนึ่งปี');

--changeset election:902-seed-e2e-exercise-candidates context:e2e-exercise
INSERT INTO candidates (district_id, party_id, number, first_name, last_name) VALUES
    ('CM-2', (SELECT id FROM parties WHERE name = 'พรรคดอยสุเทพ'), 1, 'อนันต์', 'ศรีสุข'),
    ('CM-2', (SELECT id FROM parties WHERE name = 'พรรคแม่ปิง'),   2, 'มาลี',   'วงศ์คำ');
```

- `context:e2e-exercise` = changeset นี้รัน **เฉพาะ** ตอนสั่ง `LIQUIBASE_COMMAND_CONTEXTS` ที่มี `e2e-exercise` (ดู script `db:migrate:e2e-exercise` ใน `app/package.json`)
  `npm run db:migrate:e2e` และ `npm run test:e2e` เดิมจึงไม่ได้ข้อมูลชุดนี้ไปด้วย
- ไฟล์ถูก `include` ไว้ท้าย `db/changelog/db.changelog-master.yaml` ต่อจาก `901-e2e-seed.sql`

✅ ตรวจว่า changeset `902-*` รันแล้ว และมีผู้สมัคร 2 คนในเขต CM-2:

```bash
docker compose run --rm -e LIQUIBASE_COMMAND_URL=jdbc:postgresql://db-e2e:5432/election_e2e liquibase history
docker compose exec db-e2e psql -U election -d election_e2e \
  -c "SELECT c.district_id, c.number, c.first_name, p.name FROM candidates c JOIN parties p ON p.id = c.party_id"
```

> **Test data มาจากไหนได้บ้าง?** (1) SQL เข้า database ตรงๆ ผ่าน Liquibase แบบที่ทำนี้: เร็ว มี version อยู่ใน git และ test ไม่ต้องรู้จัก role กกต.
> (2) เรียก API ในฐานะ กกต. (`POST /parties`, `POST /districts/:id/candidates`): ช้ากว่า แต่ผ่าน business rule จริง
> แบบที่ (2) คือสิ่งที่ `app/e2e/support/electionApi.ts` ทำ ลองเปรียบเทียบดู

### Step 2 — Start SUT · 5 นาที

📂 `app/`

```bash
# ยังอยู่ใน app/
docker compose up -d --build --force-recreate --wait app
curl http://localhost:3000/health
```

✅ `{"status":"ok"}`

- `--build` = build Docker image จากโค้ดล่าสุด
- `--force-recreate` = start SUT ใหม่เสมอ ให้ต่อกับ database ที่เพิ่งสร้างใน Step 1 (ไม่ค้าง connection เก่า)
- `--wait` = รอจน healthcheck (`GET /health`) ผ่าน ไม่ต้อง `sleep` เดา
- SUT ต่อ database ผ่าน `DATABASE_URL=postgres://election:election@db-e2e:5432/election_e2e` (ชื่อ `db-e2e` ใช้ได้เพราะอยู่ใน Docker network เดียวกัน)

ดู log ของ SUT ได้ด้วย `docker compose logs -f app`

### Step 3 — Setup Playwright project และทดสอบ setup · 15 นาที

📂 `app/` → `e2e-exercise/` (ขั้นแรกของ Step นี้สร้างและย้ายเข้า `e2e-exercise/`)

สร้าง Playwright project แยกจาก `app/` เพื่อย้ำว่า test เป็น **คนนอก** ที่รู้จักแค่ HTTP

```bash
cd ..                     # กลับไป root ของ repo
mkdir -p e2e-exercise/tests e2e-exercise/tools
cd e2e-exercise
npm init -y
npm install -D @playwright/test @types/node@24
printf 'node_modules/\nplaywright-report/\ntest-results/\n' > .gitignore
```

> lab นี้ทดสอบระดับ API จึง **ไม่ต้อง** `npx playwright install` (ไม่ต้องใช้ browser)

**3.1** สร้าง `e2e-exercise/playwright.config.ts`

```ts
import { defineConfig } from '@playwright/test';

// API-level e2e: no browser, Playwright only sends HTTP requests to the SUT.
export default defineConfig({
  testDir: './tests',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { Accept: 'application/json' },
  },
});
```

- `baseURL` ทำให้ใน test เขียนแค่ `request.get('/health')` ได้ และเปลี่ยนไปยิง environment อื่นได้ด้วย `BASE_URL=... npx playwright test`
- fixture `request` (`APIRequestContext`) คือ HTTP client ของ Playwright

**3.2** เพิ่ม scripts ใน `e2e-exercise/package.json`

```bash
npm pkg set scripts.test="playwright test" scripts.report="playwright show-report"
```

**3.3** สร้าง smoke test `e2e-exercise/tests/health.spec.ts` เพื่อพิสูจน์ว่า setup ถูก

```ts
import { expect, test } from '@playwright/test';

// Smoke test: proves Playwright can reach the SUT before we write real tests.
test('the election API is up', async ({ request }) => {
  const res = await request.get('/health');

  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});
```

```bash
npm test
```

✅ `1 passed`

🔴 ลองทำให้แดงด้วยเหตุผลที่ถูก (ยังอยู่ใน `e2e-exercise/`):

```bash
(cd ../app && docker compose stop app)    # หยุด SUT (วงเล็บ = cd แค่ชั่วคราว ไม่ย้าย directory ของเรา)
npm test                                  # → ECONNREFUSED: Playwright ต่อ SUT ไม่ได้
(cd ../app && docker compose start app)   # start SUT กลับมา
npm test                                  # → เขียวอีกครั้ง
```

> ระวัง: ถ้า `cd ../app` แบบไม่มีวงเล็บ แล้วพิมพ์ `npm test` จะกลายเป็นรัน Jest test ของ `app/` แทน Playwright

> ถ้า smoke test ยังไม่เขียว **อย่าเพิ่ง** เขียน test ถัดไป: ถ้า setup ผิด test ทุกตัวจะแดงด้วยเหตุผลที่ไม่เกี่ยวกับ feature

### Step 4 — เขียน e2e test: voter ลงทะเบียน แล้วเห็นรายชื่อผู้สมัคร · 30 นาที

📂 `e2e-exercise/`

#### 4.0 — Automated test ต้อง repeatable

repeatable = รันซ้ำกี่ครั้งก็ได้ผลเหมือนเดิม ไม่ว่าจะรันครั้งแรกหรือครั้งที่ 100 ถ้า test เขียวครั้งแรกแต่แดงครั้งที่สองโดยที่โค้ดไม่ได้เปลี่ยน เราจะเลิกเชื่อ test นั้นทันที

lab นี้ทำให้ repeatable ด้วย 2 อย่าง:

- **สภาพแวดล้อมเหมือนเดิมทุกรอบ** — ทุกรอบเริ่มจาก Step 1 (database ว่าง + test data ชุดเดิม) และจบที่ Step 6 (ทิ้งทั้งหมด)
  วงจร `Step 1 → 2 → npm test → Step 6` จึงรันซ้ำได้ไม่จำกัด
- **1 test case : 1 test data** — แต่ละ test case มี test data ของตัวเอง **fix ไว้ใน test** ไม่แชร์กับ test case อื่น
  - ผู้สมัคร 2 คนในเขต `CM-2` (`902-e2e-exercise-seed.sql`) และ voter ที่จะลงทะเบียน เป็นของ test case นี้เท่านั้น
  - test case ใหม่ต้องมี test data ชุดใหม่ของตัวเอง (`nationalId` ใหม่, เขตอื่น) ไม่อย่างนั้น test จะชนกันเอง

#### 4.1 — เริ่มจาก test data: สร้าง `nationalId` ด้วย `randomThaiNationalId()` แล้ว fix ไว้ใน test

`nationalId` ต้องผ่าน **checksum ของเลขบัตรประชาชนไทย** (ไม่อย่างนั้นได้ `400 invalid national id`) จะคิดเองก็ยาก
→ สร้าง tool `e2e-exercise/tools/randomThaiNationalId.mjs` ไว้ **generate test data** (ไม่ได้ถูกเรียกตอน test รัน)

```js
// Generates test data: a random national ID that passes the Thai checksum.
// Run it once, then fix the printed value in the test case:
//
//   node tools/randomThaiNationalId.mjs

import { fileURLToPath } from 'node:url';

/** @returns {string} 13 digits, starting with 9 so it never clashes with the seeded accounts */
export function randomThaiNationalId() {
  const first12 = '9' + Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join('');
  const sum = [...first12].reduce((acc, digit, i) => acc + Number(digit) * (13 - i), 0);
  return first12 + ((11 - (sum % 11)) % 10);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(randomThaiNationalId());
}
```

> checksum: คูณหลักที่ 1–12 ด้วย 13, 12, …, 2 แล้วรวมกัน → หลักที่ 13 = `(11 - (sum % 11)) % 10`

รัน 1 ครั้ง แล้ว copy เลขที่ได้ไปใช้ใน test

```bash
# อยู่ใน e2e-exercise/
node tools/randomThaiNationalId.mjs
# 9280860332162   ← เลขของแต่ละคนจะไม่เหมือนกัน
```

> ทำไม **fix** ไว้ ไม่สุ่มใหม่ทุกครั้งที่ test รัน? test data ที่ fix ไว้ทำให้ test **deterministic**: รันกี่รอบก็ส่ง request เดิม
> เมื่อ fail เราเอา `nationalId` เดิมไปไล่ดูใน database / log ของ SUT ได้ทันที

#### 4.2 — เขียน test case: voter ลงทะเบียน แล้วเห็นรายชื่อผู้สมัคร

**โครงสร้างของ Playwright test script**

test script 1 ไฟล์ (`*.spec.ts` ใน `tests/`) มีส่วนประกอบแบบนี้ (เทียบกับ `health.spec.ts` ใน Step 3 ที่เป็นตัวอย่างสั้นที่สุด):

```ts
import { expect, test } from '@playwright/test';            // ① import

test('ชื่อ test case', async ({ request }) => {              // ② test case 1 ตัว
  const data = { /* ... */ };                                // ③ Arrange: test data

  const res = await test.step('ชื่อขั้น', () =>              // ④ step: ทำอะไรสักอย่าง (Act)
    request.get('/some/path'),
  );

  await test.step('ชื่อขั้น', async () => {                   // ⑤ step: ตรวจผล (Assert)
    expect(res.status()).toBe(200);
  });
});                                                          // ⑥ ปิด test case
```

| # | ส่วน | ความหมาย |
| --- | --- | --- |
| ① | `import { expect, test }` | `test` ใช้ประกาศ test case, `expect` ใช้ assert |
| ② | `test('ชื่อ', async ({ request }) => { ... })` | **test case 1 ตัว** ชื่อจะแสดงใน report · ต้องเป็น `async` เพราะการยิง HTTP ต้องรอผล (`await`) · `{ request }` คือ **fixture** ที่ Playwright เตรียมให้: HTTP client ที่รู้ `baseURL` จาก `playwright.config.ts` แล้ว |
| ③ | `const ...` | test data ของ test case นี้ ประกาศไว้ **ใน** test case |
| ④⑤ | `await test.step('ชื่อ', async () => { ... })` | แบ่ง test case เป็นขั้นๆ ให้ report แสดงทีละขั้น · `test.step()` **return ค่าได้** จึงส่งผลลัพธ์ (เช่น response, token) ต่อให้ขั้นถัดไป · ลืม `await` = ขั้นนั้นไม่ได้รอให้เสร็จ |
| ⑤ ข้างใน step | `expect(actual).toBe(expected)` | assertion: ถ้าไม่ตรง test **หยุดทันที** ที่บรรทัดนั้น และ fail |
| ⑥ | `});` | ปิด test case: **code ทุกขั้นต้องอยู่ก่อนบรรทัดนี้** |

**เริ่มจาก skeleton**

สร้าง `e2e-exercise/tests/voter-sees-candidates.spec.ts` แล้ว copy skeleton นี้ไปวาง: มีที่ว่างสำหรับทุกขั้นไว้แล้ว เป็นบรรทัด comment

```ts
import { expect, test } from '@playwright/test';

test('a voter registers and then sees the candidates of their district', async ({ request }) => {
  // Test data owned by this test case only. nationalId came from `node tools/randomThaiNationalId.mjs`.

  // 1st step: voter goes to register

  // 2nd step: assert the response

  // 3rd step: voter logs in

  // 4th step: voter requests the candidates from the election API

  // 5th step: assert the candidates (the ones from 902-e2e-exercise-seed.sql)
});
```

**วิธีเติม code:** ในแต่ละขั้นด้านล่าง บรรทัดแรกของ code คือ comment ที่ **มีอยู่แล้ว** ใน skeleton → หา comment นั้นในไฟล์ แล้ววาง code บรรทัดที่เหลือไว้ **ใต้** comment นั้น (ย่อหน้า 2 ช่อง เพราะอยู่ใน test case)

แต่ละขั้นอยู่ใน `test.step()` ของตัวเอง เพื่อให้ report แสดงแต่ละขั้นของ journey แยกกัน:

| ขั้น | `test.step()` | ทำอะไร |
| --- | --- | --- |
| 4.2.1 | `voter registers` | `POST /auth/register` |
| 4.2.2 | `registration succeeds as a VOTER` | assert response ของการลงทะเบียน |
| 4.2.3 | `voter logs in` | `POST /auth/login` → ได้ token |
| 4.2.4 | `voter requests their candidates` | `GET /me/candidates` |
| 4.2.5 | `voter sees the CM-2 candidates` | assert รายชื่อผู้สมัคร |

##### Arrange — test data ของ test case นี้ (ข้อมูลจาก 4.1)

วางใต้ comment `// Test data owned by this test case only. ...`

```ts
  // Test data owned by this test case only. nationalId came from `node tools/randomThaiNationalId.mjs`.
  const voter = {
    nationalId: '9280860332162',
    password: 'voter1234',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    address: '239 ถนนห้วยแก้ว',
    districtId: 'CM-2',
  };
```

- `nationalId`: ใส่ **เลขของตัวเอง** ที่ได้จาก 4.1 (`9280860332162` เป็นแค่ตัวอย่าง)
- voter อยู่เขต `CM-2` ที่มีผู้สมัครของ test case นี้รออยู่ (จาก Step 1)

##### 4.2.1 — voter ไปลงทะเบียน (1st step · `POST /auth/register`)

วางใต้ comment `// 1st step: voter goes to register`

```ts
  // 1st step: voter goes to register
  const registerRes = await test.step('voter registers', () =>
    request.post('/auth/register', { data: voter }),
  );
```

- `data` = request body เป็น JSON และ Playwright ใส่ `Content-Type: application/json` ให้

##### 4.2.2 — assert response ของการลงทะเบียน (2nd step)

วางใต้ comment `// 2nd step: assert the response`

```ts
  // 2nd step: assert the response
  await test.step('registration succeeds as a VOTER', async () => {
    expect(registerRes.status(), await registerRes.text()).toBe(201);
    const user = await registerRes.json();
    expect(user).toEqual({
      id: expect.any(Number),
      nationalId: voter.nationalId,
      firstName: voter.firstName,
      lastName: voter.lastName,
      address: voter.address,
      districtId: voter.districtId,
      role: 'VOTER',
    });
    expect(user).not.toHaveProperty('passwordHash');
  });
```

- argument ตัวที่ 2 ของ `expect(..., message)` คือข้อความตอน fail → ใส่ response body ไว้ จะได้เห็น `{"error": ...}` จาก SUT ทันที
- `expect.any(Number)` = เราไม่รู้ `id` ล่วงหน้า (database เป็นคนสร้าง) จึง assert แค่ type
- `toEqual` ทั้ง object = ยืนยันด้วยว่า **ไม่มี field เกินมา** เช่น `passwordHash` (ซึ่งเป็น security requirement)

##### 4.2.3 — voter login (3rd step · `POST /auth/login`)

`GET /me/candidates` ต้องใช้ token จึงต้อง login ก่อน ด้วย `nationalId` และ `password` เดียวกับที่ลงทะเบียน

วางใต้ comment `// 3rd step: voter logs in`

```ts
  // 3rd step: voter logs in
  const token = await test.step('voter logs in', async () => {
    const loginRes = await request.post('/auth/login', {
      data: { nationalId: voter.nationalId, password: voter.password },
    });
    expect(loginRes.status(), await loginRes.text()).toBe(200);
    const { token } = await loginRes.json();
    expect(token).toEqual(expect.any(String));
    return token;
  });
```

- `test.step()` return ค่าได้ → ส่ง `token` ต่อให้ step ถัดไป
- assert การ login ไว้ใน step นี้เลย ถ้า login ไม่ผ่าน test จะ fail ที่ "voter logs in" ไม่ใช่ไปแดงงงๆ ที่ step หลัง

##### 4.2.4 — voter ขอดูรายชื่อผู้สมัครจาก election API (4th step · `GET /me/candidates`)

วางใต้ comment `// 4th step: voter requests the candidates from the election API`

```ts
  // 4th step: voter requests the candidates from the election API
  const candidatesRes = await test.step('voter requests their candidates', () =>
    request.get('/me/candidates', { headers: { Authorization: `Bearer ${token}` } }),
  );
```

- ไม่ต้องส่ง `districtId` เพราะ SUT อ่านเขตจาก **token** ของ voter

##### 4.2.5 — assert รายชื่อผู้สมัคร (5th step · ต้องตรงกับ `902-e2e-exercise-seed.sql`)

วางใต้ comment `// 5th step: assert the candidates (the ones from 902-e2e-exercise-seed.sql)`

```ts
  // 5th step: assert the candidates (the ones from 902-e2e-exercise-seed.sql)
  await test.step('voter sees the CM-2 candidates', async () => {
    expect(candidatesRes.status(), await candidatesRes.text()).toBe(200);
    expect(await candidatesRes.json()).toEqual([
      { id: expect.any(Number), number: 1, name: 'อนันต์ ศรีสุข', party: 'พรรคดอยสุเทพ', selected: false },
      { id: expect.any(Number), number: 2, name: 'มาลี วงศ์คำ', party: 'พรรคแม่ปิง', selected: false },
    ]);
  });
```

- assert ทั้ง array = ยืนยัน **ลำดับ** (เรียงตาม `number`), **เฉพาะเขต CM-2** (ไม่มีผู้สมัครเขตอื่นปนมา) และ `selected: false` (voter ใหม่ยังไม่ได้ลงคะแนน)

##### ไฟล์เต็ม: เทียบกับของตัวเอง

<details>
<summary><code>e2e-exercise/tests/voter-sees-candidates.spec.ts</code> (คลิกเพื่อดู)</summary>

```ts
import { expect, test } from '@playwright/test';

test('a voter registers and then sees the candidates of their district', async ({ request }) => {
  // Test data owned by this test case only. nationalId came from `node tools/randomThaiNationalId.mjs`.
  const voter = {
    nationalId: '9280860332162',
    password: 'voter1234',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    address: '239 ถนนห้วยแก้ว',
    districtId: 'CM-2',
  };

  // 1st step: voter goes to register
  const registerRes = await test.step('voter registers', () =>
    request.post('/auth/register', { data: voter }),
  );

  // 2nd step: assert the response
  await test.step('registration succeeds as a VOTER', async () => {
    expect(registerRes.status(), await registerRes.text()).toBe(201);
    const user = await registerRes.json();
    expect(user).toEqual({
      id: expect.any(Number),
      nationalId: voter.nationalId,
      firstName: voter.firstName,
      lastName: voter.lastName,
      address: voter.address,
      districtId: voter.districtId,
      role: 'VOTER',
    });
    expect(user).not.toHaveProperty('passwordHash');
  });

  // 3rd step: voter logs in
  const token = await test.step('voter logs in', async () => {
    const loginRes = await request.post('/auth/login', {
      data: { nationalId: voter.nationalId, password: voter.password },
    });
    expect(loginRes.status(), await loginRes.text()).toBe(200);
    const { token } = await loginRes.json();
    expect(token).toEqual(expect.any(String));
    return token;
  });

  // 4th step: voter requests the candidates from the election API
  const candidatesRes = await test.step('voter requests their candidates', () =>
    request.get('/me/candidates', { headers: { Authorization: `Bearer ${token}` } }),
  );

  // 5th step: assert the candidates (the ones from 902-e2e-exercise-seed.sql)
  await test.step('voter sees the CM-2 candidates', async () => {
    expect(candidatesRes.status(), await candidatesRes.text()).toBe(200);
    expect(await candidatesRes.json()).toEqual([
      { id: expect.any(Number), number: 1, name: 'อนันต์ ศรีสุข', party: 'พรรคดอยสุเทพ', selected: false },
      { id: expect.any(Number), number: 2, name: 'มาลี วงศ์คำ', party: 'พรรคแม่ปิง', selected: false },
    ]);
  });
});
```

</details>

### Step 5 — Run และดู report · 10 นาที

📂 `e2e-exercise/`

```bash
# อยู่ใน e2e-exercise/ (ไม่ใช่ app/)
npm test                  # รันทุก test
npm run report            # เปิด HTML report → คลิก test เพื่อดูแต่ละ test.step
```

✅ `passed` ทุกตัว

**พิสูจน์ว่า repeatable:** ทำ Step 6 → Step 1 → Step 2 แล้ว `npm test` อีกรอบ → ✅ `passed` เหมือนเดิม

```bash
# จาก e2e-exercise/
cd ../app
docker compose --profile e2e down                          # Step 6
docker compose up -d --force-recreate --wait db-e2e        # Step 1.1
npm run db:migrate:e2e-exercise                            # Step 1.2
docker compose up -d --build --force-recreate --wait app   # Step 2
cd ../e2e-exercise                                         # ⚠️ กลับมาก่อน npm test
npm test
```

🔴 แล้วถ้ารัน `npm test` ซ้ำ **โดยไม่ reset**?

```
registration succeeds as a VOTER
Error: {"error":"national id already registered"}
Expected: 201
Received: 409
```

fail ที่ 4.2.2: voter `nationalId` นี้ถูกลงทะเบียนไปแล้วในรอบก่อน → test data ของรอบนี้ไม่ "สด" แล้ว
**บทเรียน:** repeatable มาจาก **ทั้งวงจร** (reset environment + test data ชุดเดิม) ไม่ใช่จากการกด `npm test` ซ้ำ

🔴 ลองทำให้แดง แล้วอ่าน error message (ก่อนลองแต่ละข้อ ให้ reset ด้วย Step 6 → 1 → 2 ก่อน):

1. เปลี่ยน `districtId` ของ voter เป็น `'CM-1'` → fail ที่ 4.2.5 เพราะเขต CM-1 ไม่มีผู้สมัคร (`[]`)
2. reset database โดยไม่ inject test data: ทำ Step 1.1 แล้วใช้ `npm run db:migrate:e2e` (context `e2e` อย่างเดียว ไม่มี `e2e-exercise`) แทน 1.2 แล้วทำ Step 2 ใหม่ → fail ที่ 4.2.5 เหมือนกัน
   **บทเรียน:** e2e test พึ่ง test data ที่เตรียมไว้ ถ้า fail ต้องดูก่อนว่าเป็นเพราะ **SUT ผิด** หรือ **environment/data ผิด**
3. เปลี่ยน `password` เป็น `'1234'` → fail ที่ 4.2.2 พร้อม message `password must be at least 8 characters`

### Step 6 — Stop SUT และ dependencies · 2 นาที

📂 `e2e-exercise/` → `app/`

```bash
cd ../app
docker compose --profile e2e down
docker compose ps -a      # ต้องไม่มี container เหลือ
```

`db-e2e` ใช้ `tmpfs` ข้อมูลทั้งหมดหายไปพร้อม container → รันครั้งหน้าเริ่มจากสภาพเดิมเสมอ (repeatable)

---

## สรุปวงจรทั้งหมด

```bash
# app/
docker compose up -d --force-recreate --wait db-e2e
npm run db:migrate:e2e-exercise
docker compose up -d --build --force-recreate --wait app

# e2e-exercise/
npm test

# app/
docker compose --profile e2e down
```

## Exercise เพิ่มเติม

1. เขียน test ของ **S3**: voter ลงคะแนนให้หมายเลข 1 แล้ว `GET /me/candidates` ต้องได้ `selected: true` ที่หมายเลข 1 เท่านั้น
2. เขียน test ของ **S7**: `GET /me/candidates` โดยไม่มี token ต้องได้ `401 { "error": "authentication required" }`
3. ย้าย `register` / `login` ไปเป็น helper class (เช่น `ElectionApi`) แล้วเทียบกับ `app/e2e/support/electionApi.ts`
4. รวม Step 1, 2, 6 เป็น npm script หรือ shell script เดียว เพื่อให้ CI รันได้ด้วยคำสั่งเดียว (ดู `test:e2e` ใน `app/package.json`)

## คำถามปิด lab

- ถ้า test fail ที่ 4.2.5 เราจะรู้ได้อย่างไรว่า bug อยู่ที่ route, service, repository หรือ test data?
- ทำไม e2e test ควรมี **น้อย** เมื่อเทียบกับ unit test? อะไรบ้างที่ e2e test เท่านั้นจับได้?
- inject test data ผ่าน Liquibase (SQL) กับผ่าน API ต่างกันอย่างไร? แบบไหนเสี่ยงกว่าเมื่อ schema เปลี่ยน?
