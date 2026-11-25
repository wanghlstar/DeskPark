import { useEffect, useState } from 'react';
import { Button, Field, Segmented, Sheet, Switch, toast } from '../components/ui';
import { testConnection } from '../lib/ai/agent';
import type { AiProtocol, AiSource } from '../lib/ai/settings';
import {
  AI_DEFAULTS,
  aiReady,
  aiSettings,
  effectiveAi,
  loadServerAi,
  serverAi,
} from '../lib/ai/settings';
import { Avatar } from '../components/Seat';
import type { AvatarTheme } from '../components/pixel/characters';
import { CHARACTERS, THEME_NAME, getCharacter } from '../components/pixel/characters';
import { CharacterSprite } from '../components/pixel/CharacterSprite';
import { PixelAvatar } from '../components/pixel/PixelAvatar';
import type { VirtualCharacter } from '../lib/characters';
import { figureHeight, findCharacter, useCharacters } from '../lib/characters';
import { profile, settings } from '../lib/store';
import type { FeltTheme } from '../lib/store';
import { online } from '../lib/online';
import { getServerAddress, serverUrl, setServerAddress } from '../lib/platform';
import { testServerConnection } from '../lib/serverConnection';
import { unlockBackgroundMusic } from '../lib/music';

export const FELTS: { value: FeltTheme; label: string; color: string }[] = [
  { value: 'jade', label: '墨绿', color: '#2a6152' },
  { value: 'indigo', label: '黛蓝', color: '#2f4a72' },
  { value: 'wine', label: '酒红', color: '#6a2f3b' },
  { value: 'graphite', label: '石墨', color: '#3b3d40' },
];

export function NameEditor() {
  const p = profile.use();
  const [draft, setDraft] = useState(p.name);
  const commit = () => {
    const name = [...draft.trim()].slice(0, 12).join('');
    if (name) profile.set({ name });
    else setDraft(p.name);
  };
  return (
    <div className="name-editor">
      <Avatar name={draft || p.name} avatar={p.avatar} size={44} />
      <input
        value={draft}
        maxLength={12}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="昵称"
        placeholder="你的昵称"
      />
    </div>
  );
}

/** 形象选择：按主题分组 */
export function AvatarPicker() {
  const p = profile.use();
  return (
    <div className="avatar-picker">
      {(Object.keys(THEME_NAME) as AvatarTheme[]).map((theme) => (
        <div key={theme} className="avatar-picker__group">
          <span className="avatar-picker__title">{THEME_NAME[theme]}</span>
          <div className="avatar-picker__grid">
            {CHARACTERS.filter((c) => c.theme === theme).map((c) => (
              <button
                key={c.id}
                className={p.avatar === c.id ? 'is-on' : ''}
                onClick={() => profile.set({ avatar: c.id })}
                aria-label={c.name}
                title={c.name}
              >
                <PixelAvatar avatar={c.id} name={c.name} size={46} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FigureButton({ c, on, onPick }: { c: VirtualCharacter; on: boolean; onPick: () => void }) {
  return (
    <button
      className={`is-vc ${on ? 'is-on' : ''}`}
      onClick={onPick}
      aria-label={c.name}
      title={c.name}
    >
      <CharacterSprite character={c} height={figureHeight(c, 96)} seed={c.id} />
      <span>{c.name}</span>
    </button>
  );
}

/** 虚拟形象选择：与像素头像一一对应的全身像 + 额外角色 */
export function FigurePicker() {
  const p = profile.use();
  const list = useCharacters();
  const byAvatar = new Map(list.filter((c) => c.avatar).map((c) => [c.avatar, c]));
  const extras = list.filter((c) => !c.avatar);
  return (
    <div className="avatar-picker">
      {(Object.keys(THEME_NAME) as AvatarTheme[]).map((theme) => {
        const items = CHARACTERS.filter((a) => a.theme === theme && byAvatar.has(a.id));
        if (!items.length) return null;
        return (
          <div key={theme} className="avatar-picker__group">
            <span className="avatar-picker__title">{THEME_NAME[theme]}</span>
            <div className="avatar-picker__grid">
              {items.map((a) => (
                <FigureButton
                  key={a.id}
                  c={byAvatar.get(a.id)!}
                  on={p.avatar === a.id}
                  onPick={() => profile.set({ avatar: a.id })}
                />
              ))}
            </div>
          </div>
        );
      })}
      {extras.length > 0 && (
        <div className="avatar-picker__group">
          <span className="avatar-picker__title">特别角色</span>
          <div className="avatar-picker__grid">
            {extras.map((c) => (
              <FigureButton
                key={c.id}
                c={c}
                on={p.avatar === `vc:${c.id}`}
                onPick={() => profile.set({ avatar: `vc:${c.id}` })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 头像 / 虚拟形象 模式切换（显示偏好，只影响自己看到的牌桌） */
export function FigureModeSwitch() {
  const s = settings.use();
  const list = useCharacters();
  if (!list.length) return null;
  return (
    <Segmented
      value={s.figures ? 'figure' : 'pixel'}
      onChange={(m) => settings.set({ figures: m === 'figure' })}
      options={[
        { value: 'pixel', label: '像素头像' },
        { value: 'figure', label: '虚拟形象' },
      ]}
    />
  );
}

function AvatarSection() {
  const p = profile.use();
  const s = settings.use();
  const list = useCharacters();
  const figures = s.figures && list.length > 0;
  const current = findCharacter(list, p.avatar)?.name ?? getCharacter(p.avatar)?.name;
  return (
    <div className="field field--stack">
      <div className="field__label">
        <span>形象</span>
        <small>{current ?? ''}</small>
      </div>
      <FigureModeSwitch />
      {figures && <p className="field__note">牌桌上所有人（包括电脑）都会以全身形象显示</p>}
      {figures ? <FigurePicker /> : <AvatarPicker />}
    </div>
  );
}

function ServerSection() {
  const [address, setAddress] = useState(getServerAddress);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState('');
  const test = async () => {
    setTesting(true);
    setResult('');
    try {
      await testServerConnection(address);
      setResult('连接成功，服务器可用；保存后生效。');
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };
  const save = () => {
    try {
      setServerAddress(address);
      if (online.getState().room && online.getState().status === 'open')
        online.send({ t: 'leave' });
      online.disconnect();
      location.reload();
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="field field--stack ai-settings">
      <div className="field__label">
        <span>联机服务器</span>
        <small>联机、邀请链接和服务器默认 AI 共用此地址</small>
      </div>
      <label className="ai-input">
        <span>服务器地址</span>
        <input
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setResult('');
          }}
          placeholder="http://192.168.2.8:8787"
          inputMode="url"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          disabled={testing}
        />
      </label>
      <div className="ai-row">
        <Button size="sm" onClick={test} disabled={testing}>
          {testing ? '测试中…' : '测试服务器'}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={save}
          disabled={testing || address === getServerAddress()}
        >
          保存并刷新
        </Button>
      </div>
      {result && (
        <p className="field__note" role="status">
          {result}
        </p>
      )}
      <p className="field__note">
        当前联机地址：{serverUrl()}。留空恢复安装包预设；没有预设时仍可单人游戏。
        保存会关闭旧连接并刷新，保留本机单人存档和个人 AI 配置。好友需连接同一服务器。
      </p>
    </div>
  );
}

/** AI 人机：服务器默认模型与本机自定义接口。 */
function AiSection() {
  const a = aiSettings.use();
  const server = serverAi.use();
  const source = effectiveAi(a).source;
  const d = AI_DEFAULTS[a.protocol];
  const [testing, setTesting] = useState(false);
  const test = async () => {
    setTesting(true);
    try {
      const reply = await testConnection();
      toast(`连接成功：${reply}`);
    } catch (e) {
      toast(`连接失败：${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="field field--stack ai-settings">
      <div className="field__label">
        <span>AI 人机</span>
        <small>点电脑玩家头像上方的 ✨ 唤醒，由大模型接管它出牌和聊天</small>
      </div>
      <Segmented<AiSource>
        value={source}
        onChange={(source) => aiSettings.set({ source })}
        options={[
          { value: 'server', label: '服务器默认' },
          { value: 'custom', label: '自定义' },
        ]}
      />
      {source === 'server' ? (
        <p className="field__note">
          {server.configured ? (
            <>
              <strong>
                {server.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'} · {server.model}
              </strong>
              <br />
              由服务器使用后台配置的地址和 Key 调用，无需在此填写。
            </>
          ) : (
            <>
              服务器尚未配置默认 AI。飞牛管理员可在「应用中心 → 闲亭 DeskPark →
              设置」填写协议、地址、Key 和模型；也可切换为自定义。
            </>
          )}
        </p>
      ) : (
        <>
          <Segmented<AiProtocol>
            value={a.protocol}
            onChange={(protocol) => aiSettings.set({ protocol })}
            options={[
              { value: 'anthropic', label: 'Anthropic' },
              { value: 'openai', label: 'OpenAI 兼容' },
            ]}
          />
          <label className="ai-input">
            <span>接口地址</span>
            <input
              value={a.baseUrl}
              placeholder={d.baseUrl}
              onChange={(e) => aiSettings.set({ baseUrl: e.target.value })}
              spellCheck={false}
              inputMode="url"
            />
          </label>
          <label className="ai-input">
            <span>API Key</span>
            <input
              type="password"
              value={a.apiKey}
              placeholder={a.protocol === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
              onChange={(e) => aiSettings.set({ apiKey: e.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="ai-input">
            <span>模型</span>
            <input
              value={a.model}
              placeholder={d.model || '例如 deepseek-chat、qwen-plus'}
              onChange={(e) => aiSettings.set({ model: e.target.value })}
              spellCheck={false}
            />
          </label>
          <div className="ai-row">
            <span>
              经服务器转发
              <small>
                仅转发你填写的配置；内网接口需先由管理员允许，开启后仍使用你自己的模型和 Key
              </small>
            </span>
            <Switch checked={a.proxy} onChange={(proxy) => aiSettings.set({ proxy })} />
          </div>
        </>
      )}
      <div className="ai-row">
        <span>发言</span>
        <Segmented<number>
          value={a.chat}
          onChange={(chat) => aiSettings.set({ chat: chat as 0 | 1 | 2 | 3 })}
          options={[
            { value: 0, label: '不说话' },
            { value: 1, label: '偶尔' },
            { value: 2, label: '适中' },
            { value: 3, label: '话痨' },
          ]}
        />
      </div>
      <Button variant="secondary" size="sm" onClick={test} disabled={testing || !aiReady(a)}>
        {testing ? '测试中…' : '测试连接'}
      </Button>
      <p className="field__note">
        {source === 'server'
          ? '服务器默认模型的 Key 保留在服务器；单人对局仍由这台设备组织局面并提交 AI 请求。'
          : '自定义 Key 只保存在这台设备的浏览器里；对局信息发给你填写的接口，开启转发时经服务器中转。'}
      </p>
    </div>
  );
}

export function SettingsSheet({
  open,
  onClose,
  showProfile,
}: {
  open: boolean;
  onClose: () => void;
  showProfile?: boolean;
}) {
  const s = settings.use();
  const hasFigures = useCharacters().length > 0;
  useEffect(() => {
    if (open && showProfile) void loadServerAi();
  }, [open, showProfile]);
  return (
    <Sheet open={open} onClose={onClose} title={showProfile ? '设置' : '外观'}>
      {showProfile && (
        <>
          <ServerSection />
          <Field label="昵称" hint="联机时其他玩家看到的名字">
            <NameEditor />
          </Field>
          <AvatarSection />
        </>
      )}
      <AiSection />
      <Field label="桌布">
        <div className="felt-picker">
          {FELTS.map((f) => (
            <button
              key={f.value}
              className={s.felt === f.value ? 'is-on' : ''}
              onClick={() => settings.set({ felt: f.value })}
              aria-label={f.label}
            >
              <i style={{ background: f.color }} />
              <span>{f.label}</span>
            </button>
          ))}
        </div>
      </Field>
      {!showProfile && hasFigures && (
        <Field label="虚拟形象" hint="牌桌上所有人以全身像素形象显示">
          <Switch checked={s.figures} onChange={(v) => settings.set({ figures: v })} />
        </Field>
      )}
      <Field label="四色牌" hint="方块蓝色、梅花绿色">
        <Switch checked={s.fourColor} onChange={(v) => settings.set({ fourColor: v })} />
      </Field>
      <Field label="记牌器" hint="斗地主中显示剩余的牌">
        <Switch checked={s.cardCounter} onChange={(v) => settings.set({ cardCounter: v })} />
      </Field>
      <Field label="导师精算" hint="四川麻将导师在后台模拟几百局，修正出牌建议；手机较慢时可以关">
        <Switch checked={s.mjCoachMc} onChange={(v) => settings.set({ mjCoachMc: v })} />
      </Field>
      <Field label="音效">
        <Switch checked={s.sound} onChange={(v) => settings.set({ sound: v })} />
      </Field>
      <Field label="背景音乐" hint="原创小曲，随玩法切换；切到后台暂停">
        <Switch
          checked={s.music}
          onChange={(music) => {
            settings.set({ music });
            unlockBackgroundMusic();
          }}
        />
      </Field>
      <Field label="音乐音量" hint={`${Math.round(s.musicVolume * 100)}%`}>
        <input
          className="music-volume"
          type="range"
          aria-label="音乐音量"
          min="0"
          max="100"
          step="1"
          value={Math.round(s.musicVolume * 100)}
          disabled={!s.music}
          onChange={(e) => {
            settings.set({ musicVolume: Number(e.target.value) / 100 });
            unlockBackgroundMusic();
          }}
        />
      </Field>
      <Field label="界面">
        <Segmented
          value={s.theme}
          onChange={(v) => settings.set({ theme: v })}
          options={[
            { value: 'system', label: '自动' },
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
          ]}
        />
      </Field>
    </Sheet>
  );
}
