import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { today, plusDay } from '../public/domain.js';

test('server exposes one Boss account, rejects staff creation and persists cash stays', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'staydesk-test-'));
  const port = 19437;
  const base = `http://localhost:${port}`;
  const password = 'Fictional test password 123';
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), MOTEL_DB: join(dir, 'test.sqlite'), MOTEL_INITIAL_USER: 'boss', MOTEL_INITIAL_PASSWORD: password, MOTEL_INITIAL_NAME: 'Boss' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error(`Server startup timeout ${stderr}`)), 8000);
      child.stdout.on('data', () => { clearTimeout(timeout); resolve(); });
      child.once('exit', (code) => { clearTimeout(timeout); reject(Error(`Server exit ${code} ${stderr}`)); });
    });
    const get = (path, cookie = '') => fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
    const post = (path, body, cookie = '', origin = base) => fetch(base + `/api/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Staydesk-Request': '1', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
    });
    assert.equal((await get('/api/state')).status, 401);
    assert.equal((await post('login', { username: 'boss', password: 'bad' })).status, 401);
    assert.equal((await post('login', { username: 'boss', password }, '', 'https://evil.example')).status, 403);
    const login = await post('login', { username: 'boss', password });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const initial = await (await get('/api/state', cookie)).json();
    assert.equal(initial.db.staff.length, 1);
    assert.equal(initial.db.staff[0].name, 'Boss');
    assert.equal(initial.db.rooms.length, 0);
    assert.equal((await post('staff', { username: 'user2', name: 'User 2', password: 'Another fictional test password', revision: initial.db.revision }, cookie)).status, 404);
    const day = today();
    const create = await post('command', {
      command: 'create',
      revision: initial.db.revision,
      payload: {
        status: 'in-house', name: 'Server Guest', idType: 'Passport', idNumber: 'SERVER-1', room: '101',
        start: `${day}T15:00`, end: `${plusDay(day, 1)}T11:00`, rates: [{ date: day, amount: 10000 }], paid: 10000, deposit: 2500,
      },
    }, cookie);
    assert.equal(create.status, 200);
    const changed = await create.json();
    assert.equal(changed.db.bookings.length, 1);
    assert.equal(changed.db.rooms.length, 0);
    assert.equal(changed.db.transactions.length, 2);
    assert.equal((await post('command', { command: 'note', revision: initial.db.revision, payload: { id: changed.id, note: 'stale write' } }, cookie)).status, 409);
    await post('logout', {}, cookie);
    assert.equal((await get('/api/state', cookie)).status, 401);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
