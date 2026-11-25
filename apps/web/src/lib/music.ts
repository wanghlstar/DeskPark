import { useEffect } from 'react';
import { musicTrackFor, renderMusic } from './music-score';
import type { MusicTrack } from './music-score';
import { settings } from './store';

const buffers = new Map<MusicTrack, Promise<AudioBuffer>>();

export class BackgroundMusic {
  private ac: AudioContext | null = null;
  private volume: GainNode | null = null;
  private voices = new Map<AudioBufferSourceNode, GainNode>();
  private current: MusicTrack | null = null;
  private pending: MusicTrack | null = null;
  private track: MusicTrack = 'lively';
  private unlocked = false;
  private generation = 0;

  unlock = () => {
    this.unlocked = true;
    void this.sync();
  };

  scene(gameId?: string) {
    const track = musicTrackFor(gameId);
    if (track !== this.track) {
      this.track = track;
      this.generation++;
      this.pending = null;
    }
    void this.sync();
  }

  private fadeOut() {
    for (const [source, gain] of this.voices) {
      gain.gain.cancelScheduledValues(this.ac!.currentTime);
      gain.gain.setTargetAtTime(0, this.ac!.currentTime, 0.03);
      source.stop(this.ac!.currentTime + 0.15);
    }
  }

  pause = () => {
    this.generation++;
    this.pending = this.current = null;
    for (const source of this.voices.keys()) source.stop();
    this.voices.clear();
    if (this.ac?.state === 'running') void this.ac.suspend().catch(() => {});
  };

  async sync() {
    const s = settings.get();
    if (!this.unlocked || !s.music || s.musicVolume <= 0 || document.hidden) {
      this.pause();
      return;
    }
    try {
      if (!this.ac) {
        this.ac = new AudioContext({ latencyHint: 'playback' });
        this.volume = this.ac.createGain();
        this.volume.gain.value = s.musicVolume;
        this.volume.connect(this.ac.destination);
      }
      const ac = this.ac;
      void ac.resume().catch(() => {});
      this.volume!.gain.setTargetAtTime(
        Math.max(0, Math.min(1, s.musicVolume)),
        ac.currentTime,
        0.04,
      );
      if (this.current === this.track || this.pending === this.track) return;
      const track = this.track;
      const generation = ++this.generation;
      this.pending = track;
      if (!buffers.has(track)) buffers.set(track, renderMusic(track));
      const buffer = await buffers.get(track)!;
      if (generation !== this.generation) return;
      this.pending = null;
      this.fadeOut();
      const source = ac.createBufferSource();
      const gain = ac.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.setValueAtTime(0, ac.currentTime);
      gain.gain.linearRampToValueAtTime(1, ac.currentTime + 0.3);
      source.connect(gain).connect(this.volume!);
      this.voices.set(source, gain);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        this.voices.delete(source);
      };
      source.start();
      this.current = track;
    } catch {
      this.pending = null;
      // 不支持 Web Audio 或系统暂不允许播放时，保留游戏与原有音效。
    }
  }

  dispose = () => {
    this.pause();
    if (this.ac) void this.ac.close().catch(() => {});
    this.ac = this.volume = null;
    this.unlocked = false;
  };
}

const player = new BackgroundMusic();
export const unlockBackgroundMusic = player.unlock;

export function useBackgroundMusic(gameId?: string) {
  const s = settings.use();
  useEffect(() => {
    const sync = () => void player.sync();
    window.addEventListener('pointerdown', player.unlock, true);
    window.addEventListener('keydown', player.unlock, true);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', player.pause);
    window.addEventListener('pageshow', sync);
    return () => {
      window.removeEventListener('pointerdown', player.unlock, true);
      window.removeEventListener('keydown', player.unlock, true);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pagehide', player.pause);
      window.removeEventListener('pageshow', sync);
      player.dispose();
    };
  }, []);
  useEffect(() => player.scene(gameId), [gameId, s.music, s.musicVolume]);
}
