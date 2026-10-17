import { expect, test } from '@playwright/test';

test('the election API is up', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status(), await res.text()).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok' });
});
