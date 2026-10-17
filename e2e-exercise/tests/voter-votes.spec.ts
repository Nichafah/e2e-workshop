import { expect, test } from '@playwright/test';
import { ElectionApi } from '../support/ElectionApi';

test('S3: a voter votes for number 1 and only that candidate is selected', async ({ request }) => {
  const api = new ElectionApi(request);
  // Own district, parties, candidates and voter; does not modify S1's CM-2 data.
  const voter = {
    nationalId: '9747637058449', password: 'voter1234', firstName: 'ผู้ลงคะแนน',
    lastName: 'ทดสอบ', address: 'CAMT', districtId: 'CM-3',
  };
  const candidates: { id: number; number: number; name: string; party: string; selected: boolean }[] = [];
  await test.step('commissioner prepares two candidates in CM-3 through HTTP', async () => {
    const commissioner = await api.login({ nationalId: '1100000000024', password: 'commission1234' });
    const headers = { Authorization: `Bearer ${commissioner}` };
    for (const number of [1, 2]) {
      const partyName = `S3 party ${number}`;
      const partyRes = await request.post('/parties', { headers, data: { name: partyName, policy: 'S3 test policy' } });
      expect(partyRes.status(), await partyRes.text()).toBe(201);
      const party = await partyRes.json();
      const candidateRes = await request.post('/districts/CM-3/candidates', {
        headers, data: { partyId: party.id, number, firstName: 'ผู้สมัคร', lastName: `คนที่ ${number}` },
      });
      expect(candidateRes.status(), await candidateRes.text()).toBe(201);
      const candidate = await candidateRes.json();
      candidates.push({ id: candidate.id, number, name: `ผู้สมัคร คนที่ ${number}`, party: partyName, selected: false });
    }
  });
  const token = await test.step('a separate voter registers and logs in', async () => {
    const res = await api.register(voter);
    expect(res.status(), await res.text()).toBe(201);
    return api.login(voter);
  });
  const headers = { Authorization: `Bearer ${token}` };
  await test.step('new voter sees both candidates unselected', async () => {
    const res = await request.get('/me/candidates', { headers });
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toEqual(candidates);
  });
  await test.step('voter casts their first vote for number 1', async () => {
    const res = await request.put('/me/vote', { headers, data: { candidateId: candidates[0].id } });
    expect(res.status(), await res.text()).toBe(201);
    const vote = await res.json();
    expect(vote).toEqual({ candidateId: candidates[0].id, changed: false, votedAt: expect.any(String) });
    expect(Number.isNaN(Date.parse(vote.votedAt))).toBe(false);
  });
  await test.step('only number 1 is selected when the ballot is read again', async () => {
    const res = await request.get('/me/candidates', { headers });
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toEqual(candidates.map(c => ({ ...c, selected: c.number === 1 })));
  });
});
