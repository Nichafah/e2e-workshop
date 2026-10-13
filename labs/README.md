# Labs

แต่ละ lab มี 2 branch:

- `jest/lab/NN-name` — จุดเริ่มต้นของ lab (โจทย์อยู่ที่ `labs/NN-name/README.md`)
- `jest/solution/NN-name` — เฉลย และเป็นฐานของ lab ถัดไป

```bash
git fetch --all
git switch jest/lab/02-aaa-unit          # เริ่ม lab
git switch jest/solution/02-aaa-unit     # ดูเฉลย / ตามไม่ทัน → ไป lab ถัดไปได้เลย
```

> ตามไม่ทันไม่เป็นไร: `git stash` งานตัวเอง แล้ว `git switch jest/lab/<lab ถัดไป>` ได้ทันที
> เพราะทุก lab เริ่มจากเฉลยของ lab ก่อนหน้า

| # | Lab | ช่วงเวลา | เรื่อง | Reference |
|---|---|---|---|---|
| 00 | `00-setup` | ก่อน workshop | `npm run doctor`, test ตัวแรกผ่าน | — |
| 01 | `01-boundaries` | Day 1 เช้า | จัด test case เข้า boundary | Fowler — Testing Strategies in a Microservice Architecture |
| 02 | `02-aaa-unit` | Day 1 บ่าย-1 | Arrange / Act / Assert, test smells | xUnit Test Patterns |
| 03 | `03-test-doubles` | Day 1 บ่าย-1 | Dummy, Stub, Spy, Mock, Fake | xUnit Test Patterns |
| 04 | `04-test-data` | Day 1 บ่าย-2 | Liquibase, test DB, builders + faker, isolation | xUnit Test Patterns |
| 05 | `05-ci` | Day 1 บ่าย-2 | CI pipeline (GitHub Actions / GitLab / Jenkins) | — |
| 06 | `06-outside-in` | Day 2 เช้า | Acceptance test → component → unit | Growing Object-Oriented Software, Guided by Tests |
| 07 | `07-legacy` | Day 2 บ่าย | Characterization tests, seams, sprout | Working Effectively with Legacy Code |
| 08 | `08-own-project` | Day 2 บ่าย | นำทุกอย่างไปใช้กับโปรเจกต์ตัวเอง | — |
| — | `e2e-exercise-test` | เสริม | E2E automation ด้วย Playwright: start deps + test data → SUT → test → stop | Playwright — API testing |

Vitest version (`vitest/lab/NN-*`, `vitest/solution/NN-*`) จะตามมาหลัง workshop
