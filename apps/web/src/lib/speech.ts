import { settings } from './store';

export interface SpeechVoice {
  id: string;
  name: string;
  lang: string;
  local: boolean;
  index: number;
}

/** Capacitor 原生桥（只在 Android App 里存在） */
interface CapBridge {
  isPluginAvailable?: (name: string) => boolean;
  nativePromise?: (plugin: string, method: string, options: unknown) => Promise<unknown>;
}

function nativeTts(): CapBridge | null {
  const cap = (globalThis as { Capacitor?: CapBridge }).Capacitor;
  return cap?.nativePromise && cap.isPluginAvailable?.('TextToSpeech') ? cap : null;
}

let nativeVoices: SpeechVoice[] | null = null;
let loading: Promise<SpeechVoice[]> | null = null;
let generation = 0;

function chineseVoices(voices: SpeechSynthesisVoice[]): SpeechVoice[] {
  return voices
    .map((v, index) => ({
      id: v.voiceURI,
      name: v.name,
      lang: v.lang,
      local: v.localService,
      index,
    }))
    .filter((v) => /^(zh|cmn)(-|_|$)/i.test(v.lang))
    .sort((a, b) => {
      const score = (v: SpeechVoice) =>
        (/^(zh[-_]CN|zh[-_]Hans|cmn)/i.test(v.lang) ? 0 : 2) + Number(!v.local);
      return score(a) - score(b) || a.name.localeCompare(b.name, 'zh-CN');
    });
}

/** 原生插件的 voice 是完整列表下标；保存 voiceURI，避免语音包变化后串音色。 */
export async function loadSpeechVoices(): Promise<SpeechVoice[]> {
  const cap = nativeTts();
  if (cap) {
    if (nativeVoices) return nativeVoices;
    loading ??= cap.nativePromise!('TextToSpeech', 'getSupportedVoices', {})
      .then((result) => {
        nativeVoices = chineseVoices((result as { voices: SpeechSynthesisVoice[] }).voices);
        return nativeVoices;
      })
      .catch(() => [])
      .finally(() => {
        loading = null;
      });
    return loading;
  }
  return typeof window !== 'undefined' && window.speechSynthesis
    ? chineseVoices(window.speechSynthesis.getVoices())
    : [];
}

export function stopSpeech(): void {
  generation++;
  try {
    const cap = nativeTts();
    if (cap) void cap.nativePromise!('TextToSpeech', 'stop', {}).catch(() => {});
    else if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  } catch {
    /* 系统可能没有安装语音引擎 */
  }
}

/**
 * 用系统语音报牌（跟随「音效」开关；不支持时静默）。
 * Android App 的 WebView 没有 speechSynthesis，改用原生 TextToSpeech 插件。
 */
export function speak(text: string, opts: { interrupt?: boolean; preview?: boolean } = {}) {
  const s = settings.get();
  if (!text || (!opts.preview && (!s.sound || !s.speech))) return;
  const token = opts.interrupt === false ? generation : ++generation;
  const rate = Number.isFinite(s.speechRate) ? Math.max(0.75, Math.min(1.5, s.speechRate)) : 1.05;
  const pick = (voices: SpeechVoice[]) => voices.find((v) => v.id === s.speechVoice) ?? voices[0];
  try {
    const cap = nativeTts();
    if (cap) {
      void loadSpeechVoices()
        .then((voices) => {
          if (token !== generation) return;
          const voice = pick(voices);
          return cap.nativePromise!('TextToSpeech', 'speak', {
            text,
            lang: voice?.lang ?? 'zh-CN',
            rate,
            ...(voice ? { voice: voice.index } : {}),
            queueStrategy: opts.interrupt === false ? 1 : 0,
          });
        })
        .catch(() => {});
      return;
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const voice = pick(chineseVoices(voices));
    if (opts.interrupt !== false) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang ?? 'zh-CN';
    u.rate = rate;
    if (voice) u.voice = voices[voice.index];
    synth.speak(u);
  } catch {
    // 语音不可用时静默
  }
}
