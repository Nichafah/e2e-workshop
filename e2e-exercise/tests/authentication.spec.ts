import { expect, test } from '@playwright/test';

test('S7: candidates require authentication', async ({ request }) => {
  const res = await request.get('/me/candidates');
  expect(res.status(), await res.text()).toBe(401);
  expect(await res.json()).toEqual({ error: 'authentication required' });
});
