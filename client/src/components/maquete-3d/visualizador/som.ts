// Maquete 3D (EPIC-022, etapa 2) — trilha instrumental original, discreta, gerada por código (Web Audio):
// um colchão de acordes lentos com notas esparsas por cima. Nenhum arquivo de áudio.
const ACORDES = [
  [130.81, 196.0, 246.94, 329.63],  // Dó maior com sétima
  [110.0, 164.81, 261.63, 329.63],  // Lá menor com sétima
  [87.31, 174.61, 220.0, 329.63],   // Fá maior com sétima
  [98.0, 146.83, 246.94, 293.66],   // Sol com sexta
];
const ESCALA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; // pentatônica de dó
const COMPASSO = 7;

export type Trilha = { parar: () => void };

export function tocarTrilha(): Trilha | null {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const saida = ctx.createGain();
  saida.gain.value = 0;
  saida.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 3);
  const filtro = ctx.createBiquadFilter();
  filtro.type = "lowpass"; filtro.frequency.value = 1400; filtro.Q.value = 0.4;
  // Eco simples para dar espaço.
  const eco = ctx.createDelay(1), retorno = ctx.createGain();
  eco.delayTime.value = 0.42; retorno.gain.value = 0.28;
  filtro.connect(saida); filtro.connect(eco); eco.connect(retorno); retorno.connect(eco); eco.connect(saida);
  saida.connect(ctx.destination);

  let semente = 7, compasso = 0, ativo = true;
  const sorteio = () => { semente = (semente * 1664525 + 1013904223) >>> 0; return semente / 4294967296; };
  const nota = (freq: number, inicio: number, dur: number, vol: number, tipo: OscillatorType) => {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = tipo; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, inicio);
    g.gain.linearRampToValueAtTime(vol, inicio + Math.min(1.8, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
    osc.connect(g); g.connect(filtro);
    osc.start(inicio); osc.stop(inicio + dur + 0.1);
  };
  const agendar = () => {
    if (!ativo) return;
    const t = ctx.currentTime + 0.1, acorde = ACORDES[compasso % ACORDES.length];
    acorde.forEach((f, i) => { nota(f, t, COMPASSO + 2.5, 0.2 - i * 0.03, "sine"); nota(f * 2.005, t, COMPASSO + 2.5, 0.035, "triangle"); });
    const quantas = 2 + Math.floor(sorteio() * 3);
    for (let i = 0; i < quantas; i++) nota(ESCALA[Math.floor(sorteio() * ESCALA.length)], t + 0.6 + sorteio() * (COMPASSO - 1.5), 2.6, 0.07, "sine");
    compasso++;
  };
  agendar();
  const relogio = window.setInterval(agendar, COMPASSO * 1000);
  return {
    parar: () => {
      ativo = false; window.clearInterval(relogio);
      saida.gain.cancelScheduledValues(ctx.currentTime);
      saida.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      window.setTimeout(() => { void ctx.close(); }, 1800);
    },
  };
}
