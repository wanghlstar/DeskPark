import { PROTOCOL_VERSION } from '@park/protocol';
import { normalizeServerAddress, randomToken, serverUrl } from './platform';

/** 使用临时身份完成握手，避免测试连接挤掉当前玩家或加入其房间。 */
export function testServerConnection(address: string): Promise<void> {
  const target = serverUrl(normalizeServerAddress(address));
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target);
    const finish = (error?: string) => {
      clearTimeout(timer);
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      ws.close();
      if (error) reject(new Error(error));
      else resolve();
    };
    const timer = setTimeout(() => finish('连接超时，请检查地址、端口和手机网络'), 5_000);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({ t: 'hello', token: randomToken(), name: '连接测试', v: PROTOCOL_VERSION }),
      );
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.t === 'welcome') finish();
        else if (msg.t === 'error') finish(String(msg.message || '服务器拒绝连接'));
      } catch {
        finish('该地址未返回 DeskPark 联机协议');
      }
    };
    ws.onerror = ws.onclose = () => finish('无法连接 DeskPark，请检查地址、端口和手机网络');
  });
}
