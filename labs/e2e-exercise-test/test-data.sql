-- Test data for the e2e exercise: 2 parties with 1 candidate each in district CM-2.
-- Inject it into db-e2e AFTER Liquibase has created the schema:
--
--   cd app
--   docker compose exec -T db-e2e psql -U election -d election_e2e -v ON_ERROR_STOP=1 \
--     < ../labs/e2e-exercise-test/test-data.sql
--
-- Safe to run twice: rows that already exist are skipped.

INSERT INTO parties (name, logo_url, policy) VALUES
    ('พรรคดอยสุเทพ', NULL, 'รถแดงไฟฟ้าทุกสาย'),
    ('พรรคแม่ปิง',   NULL, 'ฝุ่น PM2.5 ต้องหมดในหนึ่งปี')
ON CONFLICT (name) DO NOTHING;

INSERT INTO candidates (district_id, party_id, number, first_name, last_name) VALUES
    ('CM-2', (SELECT id FROM parties WHERE name = 'พรรคดอยสุเทพ'), 1, 'อนันต์', 'ศรีสุข'),
    ('CM-2', (SELECT id FROM parties WHERE name = 'พรรคแม่ปิง'),   2, 'มาลี',   'วงศ์คำ')
ON CONFLICT DO NOTHING;
