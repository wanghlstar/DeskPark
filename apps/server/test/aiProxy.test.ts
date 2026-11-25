import { createServer } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkTarget, isPrivateAddress } from '../src/aiProxy';
import { startServer } from '../src/server';

let server: ReturnType<typeof startServer>;
let base = '';
let upstreamBase = '';
const received: {
  path: string;
  authorization: string | undefined;
  apiKey?: string;
  version?: string;
  body: string;
}[] = [];
const upstream = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += String(chunk);
  received.push({
    path: req.url!,
    authorization: req.headers.authorization,
    body,
    ...(req.headers['x-api-key']
      ? {
          apiKey: String(req.headers['x-api-key']),
          version: String(req.headers['anthropic-version']),
        }
      : {}),
  });
  const model = (JSON.parse(body) as { model?: string }).model;
  if (model === 'echo-secret-error') {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `invalid key: ${req.headers.authorization}` } }));
    return;
  }
  const authorized =
    req.headers.authorization === 'Bearer local-test-key' ||
    req.headers['x-api-key'] === 'local-test-key' ||
    (model === 'no-auth-model' && !req.headers.authorization);
  res.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify(
      authorized
        ? req.url === '/v1/messages'
          ? { content: [{ type: 'text', text: '你好' }], stop_reason: 'end_turn' }
          : { choices: [{ message: { content: '你好' } }] }
        : { error: { message: 'missing or invalid API key' } },
    ),
  );
});

beforeAll(async () => {
  server = startServer({ port: 0, host: '127.0.0.1', staticDir: null });
  base = `http://127.0.0.1:${await server.ready}`;
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('本地测试接口未启动');
  upstreamBase = `http://127.0.0.1:${address.port}/v1`;
});
afterAll(async () => {
  await server.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
});
afterEach(() => vi.unstubAllEnvs());

const post = (path: string, target: string) =>
  fetch(`${base}/api/ai-proxy/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ai-target': target },
    body: '{}',
  });

describe('AI 转发的安全限制', () => {
  it('识别内网与回环地址', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.8',
      '169.254.169.254',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('只接受 https 公网域名', async () => {
    await expect(checkTarget('http://api.example.com')).rejects.toThrow('https');
    await expect(checkTarget('https://127.0.0.1')).rejects.toThrow('公网域名');
    await expect(checkTarget('https://localhost')).rejects.toThrow('公网域名');
    await expect(checkTarget('https://user:pw@api.example.com')).rejects.toThrow('账号密码');
    await expect(checkTarget('https://api.example.com:8443')).rejects.toThrow('443');
    await expect(checkTarget('not a url')).rejects.toThrow('无效');
  });

  it('拒绝不支持的路径与非法目标', async () => {
    let r = await post('openai/models', 'https://api.example.com/v1');
    expect(r.status).toBe(404);
    r = await post('anthropic/v1/complete', 'https://api.example.com');
    expect(r.status).toBe(404);
    r = await post('openai/chat/completions', 'http://169.254.169.254');
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { message: string } }).error.message).toContain('https');
  });

  it('响应跨域预检', async () => {
    const r = await fetch(`${base}/api/ai-proxy/openai/chat/completions`, {
      method: 'OPTIONS',
      headers: { 'access-control-request-headers': 'authorization,content-type,x-ai-target' },
    });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('access-control-allow-headers')).toContain('authorization');
  });
});

describe('管理员指定的本地 AI 接口', () => {
  it('显式配置后支持 HTTP、内网 IP 和自定义端口', async () => {
    const target = 'http://192.168.2.8:19020/v1';
    await expect(checkTarget(target)).rejects.toThrow('https');
    vi.stubEnv('AI_PROXY_ALLOWED_TARGETS', ` ${target}/ `);
    expect((await checkTarget(target)).href).toBe(target);
  });

  it('只放行完整基址，其他主机、端口、路径和凭据仍被拒绝', async () => {
    vi.stubEnv('AI_PROXY_ALLOWED_TARGETS', 'http://192.168.2.8:19020/v1');
    for (const target of [
      'http://192.168.2.9:19020/v1',
      'http://192.168.2.8:19021/v1',
      'http://192.168.2.8:19020/other',
      'http://192.168.2.8:19020/v1/other',
      'http://user:password@192.168.2.8:19020/v1',
      'http://169.254.169.254/latest',
    ]) {
      await expect(checkTarget(target), target).rejects.toThrow();
    }
    vi.stubEnv('AI_PROXY_ALLOWED_TARGETS', 'file:///etc/passwd');
    await expect(checkTarget('file:///etc/passwd')).rejects.toThrow();
  });

  it('将请求、模型和鉴权转发到指定接口的正确端口与路径', async () => {
    vi.stubEnv('AI_PROXY_ALLOWED_TARGETS', upstreamBase);
    const body = JSON.stringify({
      model: 'local-model',
      messages: [{ role: 'user', content: '你好' }],
    });
    const response = await fetch(`${base}/api/ai-proxy/openai/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ai-target': `${upstreamBase}/`,
        authorization: 'Bearer local-test-key',
      },
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ choices: [{ message: { content: '你好' } }] });
    expect(received.at(-1)).toEqual({
      path: '/v1/chat/completions',
      authorization: 'Bearer local-test-key',
      body,
    });
  });

  it('上游鉴权失败时返回真实的 401，不将其误报为网络失败', async () => {
    vi.stubEnv('AI_PROXY_ALLOWED_TARGETS', upstreamBase);
    const response = await post('openai/chat/completions', upstreamBase);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { message: 'missing or invalid API key' } });
  });

  it('兼容当前 Anthropic SDK 使用 Bearer 形式传递自定义 Key', async () => {
    vi.stubEnv('AI_PROXY_ALLOWED_TARGETS', upstreamBase.slice(0, -3));
    const response = await fetch(`${base}/api/ai-proxy/anthropic/v1/messages`, {
      method: 'POST',
      headers: {
        'x-ai-target': upstreamBase.slice(0, -3),
        authorization: 'Bearer local-test-key',
        'anthropic-version': '2023-06-01',
      },
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      content: [{ type: 'text', text: '你好' }],
      stop_reason: 'end_turn',
    });
    expect(received.at(-1)?.authorization).toBe('Bearer local-test-key');
  });
});

describe('服务器默认 AI', () => {
  function configure(protocol: 'openai' | 'anthropic' = 'openai') {
    vi.stubEnv('AI_DEFAULT_PROTOCOL', protocol);
    vi.stubEnv(
      'AI_DEFAULT_BASE_URL',
      protocol === 'openai' ? upstreamBase : upstreamBase.slice(0, -3),
    );
    vi.stubEnv('AI_DEFAULT_API_KEY', 'local-test-key');
    vi.stubEnv('AI_DEFAULT_MODEL', 'server-model');
  }

  const defaultPost = (kind = 'openai', headers: Record<string, string> = {}, body = '{}') =>
    fetch(
      `${base}/api/ai-proxy/default/${kind}/${kind === 'openai' ? 'chat/completions' : 'v1/messages'}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      },
    );

  it('未配置、未填写模型或禁用转发时，公开配置显示不可用', async () => {
    vi.stubEnv('AI_DEFAULT_BASE_URL', '');
    const response = await fetch(`${base}/api/ai-proxy/default`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: false });
    configure();
    vi.stubEnv('AI_DEFAULT_MODEL', '');
    expect(await (await fetch(`${base}/api/ai-proxy/default`)).json()).toEqual({
      configured: false,
    });
    configure();
    vi.stubEnv('AI_PROXY', 'off');
    expect(await (await fetch(`${base}/api/ai-proxy/default`)).json()).toEqual({
      configured: false,
    });
  });

  it('只公开协议和模型，不返回地址或 Key，也不缓存配置', async () => {
    configure();
    const response = await fetch(`${base}/api/ai-proxy/default`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({
      configured: true,
      protocol: 'openai',
      model: 'server-model',
    });
  });

  it('默认调用固定使用服务器地址、Key 和模型，忽略浏览器覆盖值', async () => {
    configure();
    const messages = [{ role: 'user', content: '你好' }];
    const response = await defaultPost(
      'openai',
      { authorization: 'Bearer player-key', 'x-ai-target': 'http://169.254.169.254/latest' },
      JSON.stringify({ model: 'player-model', messages, stream: true }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ choices: [{ message: { content: '你好' } }] });
    expect(received.at(-1)).toEqual({
      path: '/v1/chat/completions',
      authorization: 'Bearer local-test-key',
      body: JSON.stringify({ model: 'server-model', messages, stream: false }),
    });
    await expect(checkTarget(upstreamBase)).rejects.toThrow('https');
  });

  it('默认 Anthropic 使用服务端密钥和 Messages 路径', async () => {
    configure('anthropic');
    const response = await defaultPost('anthropic', { 'x-api-key': 'player-key' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      content: [{ type: 'text', text: '你好' }],
      stop_reason: 'end_turn',
    });
    expect(received.at(-1)).toEqual({
      path: '/v1/messages',
      authorization: undefined,
      apiKey: 'local-test-key',
      version: '2023-06-01',
      body: JSON.stringify({ model: 'server-model', stream: false }),
    });
  });

  it('允许没有鉴权要求的默认接口不填写 Key', async () => {
    configure();
    vi.stubEnv('AI_DEFAULT_API_KEY', '');
    vi.stubEnv('AI_DEFAULT_MODEL', 'no-auth-model');
    const response = await defaultPost();
    expect(response.status).toBe(200);
    expect(received.at(-1)?.authorization).toBeUndefined();
  });

  it('缺少配置、协议不匹配或请求体非法时拒绝默认调用', async () => {
    vi.stubEnv('AI_DEFAULT_BASE_URL', '');
    expect((await defaultPost()).status).toBe(503);
    configure();
    expect((await defaultPost('anthropic')).status).toBe(400);
    for (const body of ['null', '[]', 'not json']) {
      expect((await defaultPost('openai', {}, body)).status, body).toBe(400);
    }
    expect((await post('default/openai/models', upstreamBase)).status).toBe(404);
  });

  it('无效的默认接口不启用，也不会暴露配置中的凭据', async () => {
    configure();
    for (const target of ['file:///etc/passwd', 'http://user:secret@localhost/v1', 'not a url']) {
      vi.stubEnv('AI_DEFAULT_BASE_URL', target);
      const response = await fetch(`${base}/api/ai-proxy/default`);
      expect(await response.json()).toEqual({ configured: false });
      expect((await defaultPost()).status).toBe(503);
    }
  });

  it('上游错误保留状态码，但不将服务端 Key 返回浏览器', async () => {
    configure();
    vi.stubEnv('AI_DEFAULT_MODEL', 'echo-secret-error');
    const response = await defaultPost();
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toContain('invalid key');
    expect(body).not.toContain('local-test-key');
  });
});
