--liquibase formatted sql

-- Test data for labs/e2e-exercise-test ONLY (context:e2e-exercise):
-- 2 parties with 1 candidate each in district CM-2.
-- `npm run db:migrate:e2e-exercise` runs it together with the e2e seed.

--changeset election:902-seed-e2e-exercise-parties context:e2e-exercise
INSERT INTO parties (name, logo_url, policy) VALUES
    ('พรรคดอยสุเทพ', NULL, 'รถแดงไฟฟ้าทุกสาย'),
    ('พรรคแม่ปิง',   NULL, 'ฝุ่น PM2.5 ต้องหมดในหนึ่งปี');
--rollback DELETE FROM parties WHERE name IN ('พรรคดอยสุเทพ', 'พรรคแม่ปิง');

--changeset election:902-seed-e2e-exercise-candidates context:e2e-exercise
INSERT INTO candidates (district_id, party_id, number, first_name, last_name) VALUES
    ('CM-2', (SELECT id FROM parties WHERE name = 'พรรคดอยสุเทพ'), 1, 'อนันต์', 'ศรีสุข'),
    ('CM-2', (SELECT id FROM parties WHERE name = 'พรรคแม่ปิง'),   2, 'มาลี',   'วงศ์คำ');
--rollback DELETE FROM candidates WHERE district_id = 'CM-2' AND number IN (1, 2);
