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
cd app && npm install            # ต้องใช้ตอน build image ของ SUT
docker info                      # Docker ต้องเปิดอยู่
```

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

```json
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
  - **Liquibase** (`liquibase` service) — สร้าง schema + reference data (districts) + seed ของ e2e (admin, กกต., เปิดการเลือกตั้ง)
  - **Test data** (`labs/e2e-exercise-test/test-data.sql`) — พรรค 2 พรรค + ผู้สมัคร 2 คนในเขต `CM-2` ที่ test ของเราต้องการ
- **Test runner:** Playwright (`e2e-exercise/`) — อยู่ **นอก** SUT และรู้จัก SUT แค่ทาง HTTP

```mermaid
flowchart LR
    subgraph host["เครื่องเรา (host)"]
        PW["Playwright test runner<br/>e2e-exercise/"]
        SQL["test-data.sql"]
    end

    subgraph docker["Docker Compose (project: election)"]
        APP["app — SUT<br/>Election API<br/>:3000"]
        DB[("db-e2e<br/>PostgreSQL 17<br/>:5434 → 5432")]
        LB["liquibase<br/>(run once)"]
    end

    PW -- "HTTP / JSON<br/>localhost:3000" --> APP
    APP -- "SQL (pg)<br/>DATABASE_URL" --> DB
    LB -- "1. schema + seed" --> DB
    SQL -- "2. inject test data<br/>(psql)" --> DB
```

ลำดับการ start สำคัญ: **database → schema (Liquibase) → test data → SUT → tests** และ stop กลับกัน

> ทำไมไม่ใช้ `npm run dev`? เพราะ e2e test ควรทดสอบ **สิ่งเดียวกับที่จะ deploy จริง** คือ Docker image ไม่ใช่โค้ดที่รันผ่าน `tsx` บนเครื่องเรา

---

## 5. Exercise ทีละขั้น

คำสั่งใน Step 1, 2, 6 รันใน `app/` · คำสั่งใน Step 3–5 รันใน `e2e-exercise/`

### Step 1 — Start dependencies และ inject test data · 10 นาที

```bash
cd app

# 1.1 start PostgreSQL ของ e2e (--force-recreate = ได้ database ว่างใหม่ทุกครั้ง, --wait = รอจน healthy)
docker compose up -d --force-recreate --wait db-e2e

# 1.2 สร้าง schema + seed ของ context e2e ด้วย Liquibase
npm run db:migrate:e2e

# 1.3 inject test data ของเรา (ผ่าน stdin เข้า psql ใน container)
docker compose exec -T db-e2e psql -U election -d election_e2e -v ON_ERROR_STOP=1 \
  < ../labs/e2e-exercise-test/test-data.sql
```

✅ ต้องเห็น `INSERT 0 2` สองบรรทัด (พรรค 2, ผู้สมัคร 2) ตรวจด้วย:

```bash
docker compose exec db-e2e psql -U election -d election_e2e \
  -c "SELECT c.district_id, c.number, c.first_name, p.name FROM candidates c JOIN parties p ON p.id = c.party_id"
```

> **Test data มาจากไหนได้บ้าง?** (1) SQL เข้า database ตรงๆ แบบที่ทำนี้: เร็ว และ test ไม่ต้องรู้จัก role กกต.
> (2) เรียก API ในฐานะ กกต. (`POST /parties`, `POST /districts/:id/candidates`): ช้ากว่า แต่ผ่าน business rule จริง
> แบบที่ (2) คือสิ่งที่ `app/e2e/support/electionApi.ts` ทำ ลองเปรียบเทียบดู

### Step 2 — Start SUT · 5 นาที

```bash
# ยังอยู่ใน app/
docker compose up -d --build --wait app
curl http://localhost:3000/health
```

✅ `{"status":"ok"}`

- `--build` = build Docker image จากโค้ดล่าสุด
- `--wait` = รอจน healthcheck (`GET /health`) ผ่าน ไม่ต้อง `sleep` เดา
- SUT ต่อ database ผ่าน `DATABASE_URL=postgres://election:election@db-e2e:5432/election_e2e` (ชื่อ `db-e2e` ใช้ได้เพราะอยู่ใน Docker network เดียวกัน)

ดู log ของ SUT ได้ด้วย `docker compose logs -f app`

### Step 3 — Setup Playwright project และทดสอบ setup · 15 นาที

สร้าง Playwright project แยกจาก `app/` เพื่อย้ำว่า test เป็น **คนนอก** ที่รู้จักแค่ HTTP

```bash
cd ..                     # กลับไป root ของ repo
mkdir -p e2e-exercise/tests/support
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

🔴 ลองทำให้แดงด้วยเหตุผลที่ถูก: `cd ../app && docker compose stop app` แล้ว `npm test` อีกครั้ง → `ECONNREFUSED` (Playwright ต่อ SUT ไม่ได้) จากนั้น `docker compose start app` แล้วรันใหม่ให้เขียว

> ถ้า smoke test ยังไม่เขียว **อย่าเพิ่ง** เขียน test ถัดไป: ถ้า setup ผิด test ทุกตัวจะแดงด้วยเหตุผลที่ไม่เกี่ยวกับ feature

### Step 4 — เขียน e2e test: voter ลงทะเบียน แล้วเห็นรายชื่อผู้สมัคร · 30 นาที

**4.0** ปัญหาแรก: `nationalId` ห้ามซ้ำ ถ้า hard-code ไว้ รันครั้งที่สองจะได้ `409 national id already registered`
และต้องผ่าน **checksum ของเลขบัตรประชาชนไทย** ด้วย → สร้าง helper `e2e-exercise/tests/support/thaiNationalId.ts`

```ts
// A random national ID that passes the Thai checksum, so every run registers a new voter.
export function randomThaiNationalId(): string {
  const first12 = '9' + Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join('');
  const sum = [...first12].reduce((acc, digit, i) => acc + Number(digit) * (13 - i), 0);
  return first12 + ((11 - (sum % 11)) % 10);
}
```

> checksum: คูณหลักที่ 1–12 ด้วย 13, 12, …, 2 แล้วรวมกัน → หลักที่ 13 = `(11 - (sum % 11)) % 10`

สร้าง `e2e-exercise/tests/voter-sees-candidates.spec.ts` แล้วเขียนทีละ step ใช้ `test.step()` เพื่อให้ report แสดงแต่ละขั้นของ journey

**Arrange** — ข้อมูลของ voter (อยู่เขต `CM-2` ที่เรา inject ผู้สมัครไว้ใน Step 1)

```ts
import { expect, test } from '@playwright/test';
import { randomThaiNationalId } from './support/thaiNationalId';

test('a voter registers and then sees the candidates of their district', async ({ request }) => {
  const voter = {
    nationalId: randomThaiNationalId(),
    password: 'voter1234',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    address: '239 ถนนห้วยแก้ว',
    districtId: 'CM-2',
  };
```

**1st step — voter ไปลงทะเบียน** (`POST /auth/register`)

```ts
  // 1st step: voter goes to register
  const registerRes = await test.step('voter registers', () =>
    request.post('/auth/register', { data: voter }),
  );
```

- `data` = request body เป็น JSON และ Playwright ใส่ `Content-Type: application/json` ให้

**2nd step — assert response ของการลงทะเบียน**

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
      districtId: 'CM-2',
      role: 'VOTER',
    });
    expect(user).not.toHaveProperty('passwordHash');
  });
```

- argument ตัวที่ 2 ของ `expect(..., message)` คือข้อความตอน fail → ใส่ response body ไว้ จะได้เห็น `{"error": ...}` จาก SUT ทันที
- `expect.any(Number)` = เราไม่รู้ `id` ล่วงหน้า (database เป็นคนสร้าง) จึง assert แค่ type
- `toEqual` ทั้ง object = ยืนยันด้วยว่า **ไม่มี field เกินมา** เช่น `passwordHash` (ซึ่งเป็น security requirement)

**3rd step — voter ขอดูรายชื่อผู้สมัครจาก election API**

`GET /me/candidates` ต้องใช้ token จึงต้อง login ก่อน

```ts
  // 3rd step: voter logs in, then asks the election API for the candidates
  const candidatesRes = await test.step('voter requests their candidates', async () => {
    const loginRes = await request.post('/auth/login', {
      data: { nationalId: voter.nationalId, password: voter.password },
    });
    expect(loginRes.status(), await loginRes.text()).toBe(200);
    const { token } = await loginRes.json();

    return request.get('/me/candidates', { headers: { Authorization: `Bearer ${token}` } });
  });
```

- ไม่ต้องส่ง `districtId` เพราะ SUT อ่านเขตจาก **token** ของ voter

**4th step — assert รายชื่อผู้สมัคร** (ต้องตรงกับ `test-data.sql`)

```ts
  // 4th step: assert the candidates (the ones from test-data.sql)
  await test.step('voter sees the CM-2 candidates', async () => {
    expect(candidatesRes.status(), await candidatesRes.text()).toBe(200);
    expect(await candidatesRes.json()).toEqual([
      { id: expect.any(Number), number: 1, name: 'อนันต์ ศรีสุข', party: 'พรรคดอยสุเทพ', selected: false },
      { id: expect.any(Number), number: 2, name: 'มาลี วงศ์คำ', party: 'พรรคแม่ปิง', selected: false },
    ]);
  });
});
```

- assert ทั้ง array = ยืนยัน **ลำดับ** (เรียงตาม `number`), **เฉพาะเขต CM-2** (ไม่มีผู้สมัครเขตอื่นปนมา) และ `selected: false` (voter ใหม่ยังไม่ได้ลงคะแนน)

### Step 5 — Run และดู report · 10 นาที

```bash
npm test                  # รันทุก test
npm test -- --repeat-each=3   # รันซ้ำ 3 รอบ ต้องเขียวทุกรอบ (ไม่มี 409 เพราะ nationalId สุ่มใหม่)
npm run report            # เปิด HTML report → คลิก test เพื่อดูแต่ละ test.step
```

✅ `passed` ทุกตัว

🔴 ลองทำให้แดง แล้วอ่าน error message:

1. เปลี่ยน `districtId` ของ voter เป็น `'CM-1'` → step 4 fail เพราะเขต CM-1 ไม่มีผู้สมัคร (`[]`)
2. reset database โดยไม่ inject test data (ทำ Step 1.1–1.2 แล้ว Step 2 ใหม่ ข้าม 1.3) → step 4 fail เหมือนกัน
   **บทเรียน:** e2e test พึ่ง test data ที่เตรียมไว้ ถ้า fail ต้องดูก่อนว่าเป็นเพราะ **SUT ผิด** หรือ **environment/data ผิด**
3. เปลี่ยน `password` เป็น `'1234'` → step 2 fail พร้อม message `password must be at least 8 characters`

### Step 6 — Stop SUT และ dependencies · 2 นาที

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
npm run db:migrate:e2e
docker compose exec -T db-e2e psql -U election -d election_e2e -v ON_ERROR_STOP=1 < ../labs/e2e-exercise-test/test-data.sql
docker compose up -d --build --wait app

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

- ถ้า test fail ที่ step 4 เราจะรู้ได้อย่างไรว่า bug อยู่ที่ route, service, repository หรือ test data?
- ทำไม e2e test ควรมี **น้อย** เมื่อเทียบกับ unit test? อะไรบ้างที่ e2e test เท่านั้นจับได้?
- inject test data ผ่าน SQL กับผ่าน API ต่างกันอย่างไร? แบบไหนเสี่ยงกว่าเมื่อ schema เปลี่ยน?
