import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const pack = resolve('dist/fnos/package');
const main = join(pack, 'cmd/main');

function invoke(command, env) {
  return new Promise((resolve) => {
    execFile('bash', [main, command], { env, timeout: 20_000 }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

async function fixture(t) {
  assert.ok(existsSync(main), 'FPK 缺少服务管理入口；请先构建打包目录');
  const data = mkdtempSync(join(tmpdir(), 'deskpark-fpk-'));
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const env = {
    ...process.env,
    PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
    TRIM_APPDEST: join(pack, 'app'),
    TRIM_PKGVAR: data,
    TRIM_SERVICE_PORT: String(port),
    TRIM_TEMP_LOGFILE: join(data, 'error.log'),
  };
  t.after(async () => {
    await invoke('stop', env);
    rmSync(data, { recursive: true, force: true });
  });
  return { data, env, port, url: `http://127.0.0.1:${port}` };
}

test('FPK 可启动真实服务，提供网页与 WebSocket，重复启动后仍可正常停止', async (t) => {
  const { data, env, port, url } = await fixture(t);
  assert.equal((await invoke('status', env)).code, 3);
  const started = await invoke('start', env);
  assert.equal(started.code, 0, started.stderr);
  assert.equal((await invoke('status', env)).code, 0);
  const pid = readFileSync(join(data, 'deskpark.pid'), 'utf8');
  assert.equal((await invoke('start', env)).code, 0);
  assert.equal(readFileSync(join(data, 'deskpark.pid'), 'utf8'), pid);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
  const page = await fetch(`${url}/room/ABCD`);
  assert.match(await page.text(), /闲亭/);
  assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.ok(existsSync(join(env.TRIM_APPDEST, 'web/engines/stockfish/COPYING.txt')));
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await once(socket, 'open', { signal: AbortSignal.timeout(5_000) });
  socket.close();
  await once(socket, 'close', { signal: AbortSignal.timeout(5_000) });
  assert.equal((await invoke('stop', env)).code, 0);
  assert.equal((await invoke('status', env)).code, 3);
  assert.equal((await invoke('stop', env)).code, 0);
});

test('失效 PID 不会将其他进程识别为 DeskPark，也不会停止其他进程', async (t) => {
  const { data, env } = await fixture(t);
  writeFileSync(join(data, 'deskpark.pid'), `${process.pid}\n`);
  assert.equal((await invoke('status', env)).code, 3);
  writeFileSync(join(data, 'deskpark.pid'), `${process.pid}\n`);
  assert.equal((await invoke('stop', env)).code, 0);
  assert.ok(process.kill(process.pid, 0));
});

test('端口已占用时启动失败并提供可见错误', async (t) => {
  const { env, port } = await fixture(t);
  const listener = createServer().listen(port, '0.0.0.0');
  await once(listener, 'listening');
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  assert.equal((await invoke('start', env)).code, 1);
  assert.match(readFileSync(env.TRIM_TEMP_LOGFILE, 'utf8'), /端口/);
  assert.equal((await invoke('status', env)).code, 3);
});
