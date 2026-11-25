/** 原创五声音阶小曲。-1 为休止，-2 为延音；每行一小节、每格半拍。 */
export type MusicTrack = 'lively' | 'calm';

const MELODIES: Record<MusicTrack, number[][]> = {
  lively: [
    [0, 2, 4, -2, 7, 4, 2, 0],
    [2, 4, 7, -2, 9, 7, 4, -2],
    [7, 9, 12, -2, 9, 7, 4, 2],
    [0, -2, 2, 4, 2, -2, -1, -1],
    [4, 7, 9, -2, 12, 9, 7, 4],
    [7, -2, 4, 2, 0, 2, 4, -2],
    [2, 4, 7, 9, 7, -2, 2, -2],
    [4, 2, 0, -2, -2, -2, -1, -1],
  ],
  calm: [
    [7, -2, -2, -2, 4, -2, 2, -2],
    [0, -2, -2, -2, 2, -2, -1, -1],
    [4, -2, 7, -2, 9, -2, 7, -2],
    [4, -2, -2, -2, 2, -2, -1, -1],
    [9, -2, -2, -2, 12, -2, 9, -2],
    [7, -2, 4, -2, 2, -2, -1, -1],
    [0, -2, 2, -2, 4, -2, 7, -2],
    [2, -2, 0, -2, -2, -2, -1, -1],
  ],
};

const CHORDS = [
  [0, 4, 7],
  [9, 12, 16],
  [5, 9, 12],
  [7, 11, 14],
];

export function musicTrackFor(gameId?: string): MusicTrack {
  return ['sichuan', 'pinghu', 'heluogangci', 'xiangqi', 'chess', 'gomoku', 'reversi'].includes(
    gameId ?? '',
  )
    ? 'calm'
    : 'lively';
}

/** 一次离线合成，循环播放时无需 JS 节拍器或外部音频资源。 */
export async function renderMusic(track: MusicTrack): Promise<AudioBuffer> {
  const calm = track === 'calm';
  const beat = 60 / (calm ? 84 : 108);
  const duration = 32 * 4 * beat;
  const ac = new OfflineAudioContext(1, Math.ceil(duration * 22050), 22050);
  const mix = ac.createGain();
  mix.gain.setValueAtTime(0, 0);
  mix.gain.linearRampToValueAtTime(1, 0.08);
  mix.gain.setValueAtTime(1, duration - 0.3);
  mix.gain.linearRampToValueAtTime(0, duration);
  mix.connect(ac.destination);
  const instruments = ac.createGain();
  instruments.connect(mix);
  const delay = ac.createDelay(0.4);
  const wet = ac.createGain();
  delay.delayTime.value = 0.14;
  wet.gain.value = 0.12;
  instruments.connect(delay).connect(wet).connect(mix);
  const wave = (partials: number[]) =>
    ac.createPeriodicWave(new Float32Array(partials.length), new Float32Array(partials));
  const flute = wave([0, 1, 0.08, 0.22, 0.02]);
  const string = wave([0, 1, 0.45, 0.2, 0.1, 0.04]);

  const note = (
    midi: number,
    at: number,
    length: number,
    level: number,
    voice: 'flute' | 'pluck' | 'bass' | 'wood',
  ) => {
    const start = at * beat + 0.01;
    const end = Math.min(start + length * beat, duration - 0.01);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    if (voice === 'flute') {
      osc.setPeriodicWave(flute);
      const vibrato = ac.createOscillator();
      const depth = ac.createGain();
      vibrato.frequency.value = 5.2;
      depth.gain.value = 4;
      vibrato.connect(depth).connect(osc.detune);
      vibrato.start(start);
      vibrato.stop(end);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + 0.04);
      gain.gain.linearRampToValueAtTime(level * 0.75, end - 0.04);
      gain.gain.linearRampToValueAtTime(0, end);
    } else {
      if (voice === 'pluck') osc.setPeriodicWave(string);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(level, start + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      if (voice === 'wood') osc.frequency.exponentialRampToValueAtTime(600, end);
    }
    osc.connect(gain).connect(instruments);
    osc.start(start);
    osc.stop(end);
  };

  for (let bar = 0; bar < 32; bar++) {
    const section = Math.floor(bar / 8);
    const melody = MELODIES[track][(bar + (section === 2 ? 4 : 0)) % 8];
    const chord = CHORDS[Math.floor(bar / 2) % 4];
    const base = calm ? 55 : 48;
    for (let i = 0; i < melody.length; i++) {
      if (melody[i] < 0) continue;
      let length = 1;
      while (melody[i + length] === -2) length++;
      note(
        (calm ? 67 : 72) + melody[i],
        bar * 4 + i / 2,
        length * 0.46,
        section === 1 ? 0.075 : 0.09,
        section === 1 ? 'pluck' : 'flute',
      );
    }
    const steps = calm ? [0, 1, 2, 1] : [0, 2, 1, 2, 0, 2, 1, 2];
    steps.forEach((part, i) =>
      note(base + chord[part], bar * 4 + i * (calm ? 1 : 0.5), calm ? 1.4 : 0.75, 0.045, 'pluck'),
    );
    note(base - 12 + chord[0], bar * 4, 1.4, 0.075, 'bass');
    note(base - 12 + chord[2], bar * 4 + 2, 1.2, 0.055, 'bass');
    if (!calm || bar % 2) {
      note(91, bar * 4 + 1, 0.08, calm ? 0.008 : 0.018, 'wood');
      note(91, bar * 4 + 3, 0.08, calm ? 0.006 : 0.014, 'wood');
    }
  }
  const buffer = await ac.startRendering();
  const samples = buffer.getChannelData(0);
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i] *= 0.65 / peak;
  return buffer;
}
