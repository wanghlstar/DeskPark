import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const pack = resolve('dist/fnos/package');
const main = join(pack, 'cmd/main');

function invoke(command, env) {
  return new Promise((resolve) => {
    const args = ['start', 'stop', 'status'].includes(command)
      ? [main, command]
      : [join(pack, 'cmd', command)];
    execFile('bash', args, { env, timeout: 20_000 }, (error, stdout, stderr) => {
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
    wizard_port: String(port),
    TRIM_TEMP_LOGFILE: join(data, 'error.log'),
  };
  t.after(async () => {
    await invoke('stop', env);
    rmSync(data, { recursive: true, force: true });
  });
  return { data, env, port, url: `http://127.0.0.1:${port}` };
}

test('安装向导要求填写有效端口，桌面入口使用同一向导字段', () => {
  const wizard = join(pack, 'wizard/install');
  assert.ok(existsSync(wizard), 'FPK 缺少端口安装向导');
  const steps = JSON.parse(readFileSync(wizard, 'utf8'));
  const field = steps.flatMap((step) => step.items).find((item) => item.field === 'wizard_port');
  assert.equal(field?.type, 'text');
  assert.equal(field.initValue, '8787');
  assert.ok(field.rules.some((rule) => rule.required));
  const pattern = new RegExp(field.rules.find((rule) => rule.pattern).pattern);
  for (const port of ['1024', '1099', '2000', '8787', '10000', '60000', '65000', '65535']) {
    assert.ok(pattern.test(port), `向导应接受端口 ${port}`);
  }
  for (const port of ['', '0', '1023', '65536', '99999', '08787', 'abc', '1e4']) {
    assert.ok(!pattern.test(port), `向导应拒绝端口 ${port}`);
  }
  const ui = JSON.parse(readFileSync(join(pack, 'app/ui/config'), 'utf8'));
  assert.equal(ui['.url']['deskpark.main'].port, '${wizard_port}');
  const manifest = readFileSync(join(pack, 'manifest'), 'utf8');
  assert.match(manifest, /^checkport=false$/m);
  assert.doesNotMatch(manifest, /^service_port=/m);
});

test('安装填写的端口用于服务启动，原默认端口被占用不影响运行', async (t) => {
  const { env, url } = await fixture(t);
  const listener = createServer().listen(0, '0.0.0.0');
  await once(listener, 'listening');
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  env.TRIM_SERVICE_PORT = String(listener.address().port);
  assert.equal((await invoke('install_init', env)).code, 0);
  const started = await invoke('start', env);
  assert.equal(started.code, 0, started.stderr);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
  assert.equal((await invoke('stop', env)).code, 0);
  assert.equal((await invoke('start', env)).code, 0);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
});

test('安装与启动均拒绝无效向导端口，并提示有效范围', async (t) => {
  const { env } = await fixture(t);
  for (const port of ['', '0', '1023', '65536', '99999', '08787', '-1', 'abc', '1e4']) {
    for (const command of ['install_init', 'start']) {
      const rejected = await invoke(command, { ...env, wizard_port: port });
      assert.equal(rejected.code, 1, `${command} 不应接受端口 ${JSON.stringify(port)}`);
      assert.match(readFileSync(env.TRIM_TEMP_LOGFILE, 'utf8'), /1024.*65535/);
      assert.equal((await invoke('status', env)).code, 3);
    }
  }
});

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

test('飞牛配置将本地 AI 地址用于转发，配置更新后生效且不自动启动已停止的应用', async (t) => {
  const { env, url } = await fixture(t);
  const install = JSON.parse(readFileSync(join(pack, 'wizard/install'), 'utf8'));
  const config = JSON.parse(readFileSync(join(pack, 'wizard/config'), 'utf8'));
  for (const steps of [install, config]) {
    assert.ok(
      steps.flatMap((step) => step.items).some((item) => item.field === 'wizard_ai_target'),
    );
  }
  const ai = createHttpServer((req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer fpk-test-key');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '你好' } }] }));
  }).listen(0, '127.0.0.1');
  await once(ai, 'listening');
  t.after(() => new Promise((resolve) => ai.close(resolve)));
  const target = `http://127.0.0.1:${ai.address().port}/v1`;
  const post = () =>
    fetch(`${url}/api/ai-proxy/openai/chat/completions`, {
      method: 'POST',
      headers: { 'x-ai-target': target, authorization: 'Bearer fpk-test-key' },
      body: '{}',
    });
  env.wizard_ai_target = target;
  assert.equal((await invoke('config_callback', env)).code, 0);
  assert.equal((await invoke('status', env)).code, 3);
  assert.equal((await invoke('start', env)).code, 0);
  assert.equal((await post()).status, 200);
  env.wizard_ai_target = '';
  const configured = await invoke('config_callback', env);
  assert.equal(configured.code, 0, configured.stderr);
  assert.equal((await post()).status, 400);
});

test('安装与应用设置包含可留空的默认 AI 配置，Key 使用密码字段，应用说明写清入口', () => {
  for (const wizard of ['install', 'config']) {
    const steps = JSON.parse(readFileSync(join(pack, 'wizard', wizard), 'utf8'));
    const fields = steps.flatMap((step) => step.items);
    for (const name of ['protocol', 'target', 'key', 'model']) {
      const field = fields.find((item) => item.field === `wizard_ai_${name}`);
      assert.ok(field, `${wizard} 缺少 AI ${name} 配置`);
      assert.ok(!field.rules?.some((rule) => rule.required), `${name} 应可留空`);
      if (name === 'key') assert.equal(field.type, 'password');
      if (name === 'protocol') {
        assert.equal(field.initValue, 'openai');
        assert.deepEqual(
          field.options.map((option) => option.value),
          ['openai', 'anthropic'],
        );
      } else assert.equal(field.initValue, '');
    }
  }
  assert.match(readFileSync(join(pack, 'manifest'), 'utf8'), /应用中心.*设置.*模型/);
});

test('飞牛默认 AI 使用后台模型和 Key，应用设置重启后生效且清空模型可关闭', async (t) => {
  const { env, url } = await fixture(t);
  const received = [];
  const ai = createHttpServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    received.push({
      path: req.url,
      authorization: req.headers.authorization,
      body: JSON.parse(body),
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: '你好' } }] }));
  }).listen(0, '127.0.0.1');
  await once(ai, 'listening');
  t.after(() => new Promise((resolve) => ai.close(resolve)));
  env.wizard_ai_target = `http://127.0.0.1:${ai.address().port}/v1`;
  env.wizard_ai_protocol = 'openai';
  env.wizard_ai_key = 'fpk-server-key';
  env.wizard_ai_model = 'fpk-default-model';
  const started = await invoke('start', env);
  assert.equal(started.code, 0, started.stderr);
  const get = () => fetch(`${url}/api/ai-proxy/default`).then((res) => res.json());
  assert.deepEqual(await get(), {
    configured: true,
    protocol: 'openai',
    model: 'fpk-default-model',
  });
  const post = () =>
    fetch(`${url}/api/ai-proxy/default/openai/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'ignored-player-model',
        messages: [{ role: 'user', content: '你好' }],
      }),
    });
  let response = await post();
  assert.equal(response.status, 200);
  assert.equal(received.at(-1).authorization, 'Bearer fpk-server-key');
  assert.equal(received.at(-1).body.model, 'fpk-default-model');
  assert.equal(received.at(-1).path, '/v1/chat/completions');
  env.wizard_ai_model = 'updated-default-model';
  assert.equal((await invoke('config_callback', env)).code, 0);
  assert.equal((await get()).model, 'updated-default-model');
  env.wizard_ai_model = '';
  assert.equal((await invoke('config_callback', env)).code, 0);
  assert.deepEqual(await get(), { configured: false });
  response = await post();
  assert.equal(response.status, 503);
});
