import type { LookupAddress } from 'node:dns';
import { lookup as lookupCb } from 'node:dns';
import { lookup } from 'node:dns/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { clientIp } from './net';

/**
 * AI 接口转发：浏览器直连大模型接口被跨域拦截时，由本服务器原样转发。
 *
 * 安全约束：
 * - 只转发两个固定端点：Anthropic `/v1/messages` 与 OpenAI 兼容 `/chat/completions`；
 * - 默认仅允许 https 公网域名；管理员可用 AI_PROXY_ALLOWED_TARGETS 指定完整的本地接口基址；
 * - 限制请求体大小、超时与每个 IP 的频率；不记录 Key，自定义调用不保存 Key；
 * - 默认模型使用部署者配置的固定地址、模型和 Key，公开配置不包含地址或 Key。
 * 设置环境变量 AI_PROXY=off 可关闭。
 */

const ROUTES = {
  anthropic: {
    path: '/v1/messages',
    headers: ['x-api-key', 'authorization', 'anthropic-version', 'anthropic-beta'],
  },
  openai: { path: '/chat/completions', headers: ['authorization'] },
} as const;

const PREFIX = '/api/ai-proxy/';
const MAX_BODY = 256 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;
const TIMEOUT_MS = 90_000;
const RATE_PER_MIN = 40;

export const aiProxyEnabled = () => process.env.AI_PROXY !== 'off';
export const isAiProxyPath = (url: string | undefined) => !!url && url.startsWith(PREFIX);

function defaultAi() {
  const protocol = process.env.AI_DEFAULT_PROTOCOL?.trim() || 'openai';
  const model = process.env.AI_DEFAULT_MODEL?.trim();
  if (!aiProxyEnabled() || !model || (protocol !== 'openai' && protocol !== 'anthropic'))
    return null;
  try {
    const target = new URL(process.env.AI_DEFAULT_BASE_URL?.trim() ?? '');
    if (
      !['http:', 'https:'].includes(target.protocol) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      return null;
    return { protocol, model, target, apiKey: process.env.AI_DEFAULT_API_KEY?.trim() ?? '' };
  } catch {
    return null;
  }
}

const hits = new Map<string, { start: number; n: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > 60_000) {
    hits.set(ip, { start: now, n: 1 });
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.start > 60_000) hits.delete(k);
    return false;
  }
  return ++h.n > RATE_PER_MIN;
}

/** 内网、回环、链路本地等地址 */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const x = ip.toLowerCase();
  return (
    x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || /^fe[89ab]/.test(x)
  );
}

/** 只有部署者指定的完整基址才能使用 HTTP、内网和自定义端口。 */
function allowedTarget(url: URL): boolean {
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return false;
  const base = url.href.replace(/\/+$/, '');
  return (process.env.AI_PROXY_ALLOWED_TARGETS ?? '').split(/[,\n]/).some((raw) => {
    try {
      return new URL(raw.trim()).href.replace(/\/+$/, '') === base;
    } catch {
      return false;
    }
  });
}

/** 校验目标地址，返回规范化后的 base URL；不合法时抛出给前端看的错误信息 */
export async function checkTarget(raw: string | undefined): Promise<URL> {
  let url: URL;
  try {
    url = new URL(String(raw ?? ''));
  } catch {
    throw new Error('目标接口地址无效');
  }
  if (url.username || url.password) throw new Error('目标地址不能包含账号密码');
  if (allowedTarget(url)) return url;
  if (url.protocol !== 'https:')
    throw new Error('只能转发到 https 公网接口；本地 AI 需由部署者配置允许地址');
  if (url.port && url.port !== '443') throw new Error('只能转发到默认 443 端口');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) || host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) {
    throw new Error('只能转发到公网域名');
  }
  const addrs = await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('无法解析目标域名');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error('不能转发到内网地址');
  return url;
}

function send(res: ServerResponse, status: number, body: unknown, cors: Record<string, string>) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...cors,
  });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function handleAiProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cors: Record<string, string> = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '600',
  };
  if (req.method === 'OPTIONS') {
    const asked = String(req.headers['access-control-request-headers'] ?? '');
    res.writeHead(204, { ...cors, 'access-control-allow-headers': asked.slice(0, 1000) });
    res.end();
    return;
  }
  let rest = (req.url ?? '').slice(PREFIX.length).split('?')[0];
  if (rest === 'default' && req.method === 'GET') {
    const config = defaultAi();
    return send(
      res,
      200,
      config
        ? { configured: true, protocol: config.protocol, model: config.model }
        : { configured: false },
      cors,
    );
  }
  if (!aiProxyEnabled())
    return send(res, 404, { error: { message: '本服务器未开启 AI 转发' } }, cors);
  if (req.method !== 'POST') return send(res, 405, { error: { message: '只支持 POST' } }, cors);

  const useDefault = rest.startsWith('default/');
  if (useDefault) rest = rest.slice('default/'.length);
  const kind = rest.split('/')[0] as keyof typeof ROUTES;
  const route = ROUTES[kind];
  if (!route || `/${rest.slice(kind.length + 1)}` !== route.path) {
    return send(res, 404, { error: { message: '不支持的转发路径' } }, cors);
  }
  const ip = clientIp(req);
  if (rateLimited(ip)) return send(res, 429, { error: { message: '转发请求太频繁' } }, cors);

  const config = useDefault ? defaultAi() : null;
  if (useDefault && !config)
    return send(
      res,
      503,
      { error: { message: '服务器尚未配置默认 AI，请选择自定义或联系管理员' } },
      cors,
    );
  if (config && config.protocol !== kind)
    return send(
      res,
      400,
      { error: { message: '服务器默认 AI 协议已更新，请刷新页面后重试' } },
      cors,
    );

  let target: URL;
  let body: Buffer;
  try {
    target =
      config?.target ?? (await checkTarget(req.headers['x-ai-target'] as string | undefined));
    body = await readBody(req);
    if (config) {
      const data: unknown = JSON.parse(body.toString());
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('请求体必须为 JSON 对象');
      body = Buffer.from(JSON.stringify({ ...data, model: config.model, stream: false }));
    }
  } catch (e) {
    return send(res, 400, { error: { message: (e as Error).message } }, cors);
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config) {
    if (kind === 'anthropic') headers['anthropic-version'] = '2023-06-01';
    if (config.apiKey) {
      if (kind === 'anthropic') headers['x-api-key'] = config.apiKey;
      else headers.authorization = `Bearer ${config.apiKey}`;
    }
  } else {
    for (const h of route.headers) {
      const v = req.headers[h];
      if (typeof v === 'string') headers[h] = v;
    }
  }
  const path = `${target.pathname.replace(/\/+$/, '')}${route.path}`;
  try {
    const r = await forward(target, path, headers, body, useDefault);
    res.writeHead(r.status, { 'content-type': r.type, 'cache-control': 'no-store', ...cors });
    res.end(config?.apiKey ? r.body.toString().replaceAll(config.apiKey, '[redacted]') : r.body);
  } catch (e) {
    const msg = (e as Error).message === 'too large' ? '上游响应过大' : '无法连接上游 AI 接口';
    send(res, 502, { error: { message: msg } }, cors);
  }
}

/**
 * 建立连接时再校验一次解析结果：防止 DNS 重绑定（校验时解析到公网、连接时又解析到内网）。
 */
const safeLookup: LookupFunction = (host, options, callback) => {
  lookupCb(host, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return callback(new Error('blocked address'), '', 0);
    }
    if ((options as { all?: boolean }).all)
      return (callback as never as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

function forward(
  target: URL,
  path: string,
  headers: Record<string, string>,
  body: Buffer,
  trustedTarget = false,
): Promise<{ status: number; type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = target.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = request(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ''),
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path,
        method: 'POST',
        headers: { ...headers, 'content-length': String(body.length) },
        lookup: trustedTarget || allowedTarget(target) ? undefined : safeLookup,
        timeout: TIMEOUT_MS,
      },
      (r) => {
        const chunks: Buffer[] = [];
        let size = 0;
        r.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_RESPONSE) {
            req.destroy(new Error('too large'));
            return;
          }
          chunks.push(c);
        });
        r.on('end', () =>
          resolve({
            status: r.statusCode ?? 502,
            type: String(r.headers['content-type'] ?? 'application/json'),
            body: Buffer.concat(chunks),
          }),
        );
        r.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}
