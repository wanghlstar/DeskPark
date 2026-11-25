import { createServer } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkTarget, isPrivateAddress } from '../src/aiProxy';
import { startServer } from '../src/server';

let server: ReturnType<typeof startServer>;
let base = '';
let upstreamBase = '';
const received: { path: string; authorization: string | undefined; body: string }[] = [];
const upstream = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += String(chunk);
  received.push({ path: req.url!, authorization: req.headers.authorization, body });
  const authorized = req.headers.authorization === 'Bearer local-test-key';
  res.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify(
      authorized
        ? { choices: [{ message: { content: '你好' } }] }
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
});
