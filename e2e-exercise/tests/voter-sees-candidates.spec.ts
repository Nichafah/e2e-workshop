import { expect, test } from '@playwright/test';
import { ElectionApi } from '../support/ElectionApi';

test('a voter registers and then sees the candidates of their district', async ({ request }) => {
  const api = new ElectionApi(request);
  // Generated once using tools/randomThaiNationalId.mjs; fixed for reproducibility.
  const voter = {
    nationalId: '9534815455308', password: 'voter1234', firstName: 'สมชาย',
    lastName: 'ใจดี', address: '239 ถนนห้วยแก้ว', districtId: 'CM-2',
  };
  const registerRes = await test.step('voter registers', () => api.register(voter));
  await test.step('registration succeeds as a VOTER', async () => {
    expect(registerRes.status(), await registerRes.text()).toBe(201);
    const user = await registerRes.json();
    const { password, ...publicVoter } = voter;
    expect(user).toEqual({ id: expect.any(Number), ...publicVoter, role: 'VOTER' });
    expect(user).not.toHaveProperty('passwordHash');
  });
  const token = await test.step('voter logs in', () => api.login(voter));
  const candidatesRes = await test.step('voter requests their candidates', () =>
    request.get('/me/candidates', { headers: { Authorization: `Bearer ${token}` } }),
  );
  await test.step('voter sees the CM-2 candidates', async () => {
    expect(candidatesRes.status(), await candidatesRes.text()).toBe(200);
    expect(await candidatesRes.json()).toEqual([
      { id: expect.any(Number), number: 1, name: 'อนันต์ ศรีสุข', party: 'พรรคดอยสุเทพ', selected: false },
      { id: expect.any(Number), number: 2, name: 'มาลี วงศ์คำ', party: 'พรรคแม่ปิง', selected: false },
    ]);
  });
});
