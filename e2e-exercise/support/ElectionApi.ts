import { expect, type APIRequestContext } from '@playwright/test';

export interface Voter {
  nationalId: string;
  password: string;
  firstName: string;
  lastName: string;
  address: string;
  districtId: string;
}

// This helper knows HTTP contracts only; never imports app/src or connects to SQL.
export class ElectionApi {
  constructor(private readonly request: APIRequestContext) {}

  register(voter: Voter) {
    return this.request.post('/auth/register', { data: voter });
  }

  async login(credentials: Pick<Voter, 'nationalId' | 'password'>): Promise<string> {
    const res = await this.request.post('/auth/login', {
      data: { nationalId: credentials.nationalId, password: credentials.password },
    });
    expect(res.status(), await res.text()).toBe(200);
    const { token } = await res.json();
    expect(token).toEqual(expect.any(String));
    expect(token.length).toBeGreaterThan(0);
    return token;
  }
}
