// Maquete 3D (EPIC-022, etapa 2) — iluminação por horário. O controle vai de 0 (manhã) a 0,5 (pôr do sol) e 1
// (noite), com transição contínua: posição e cor do sol, céu, luz ambiente e sombras. As reflexões dos metais e
// vidros vêm de um ambiente montado na própria cena (nenhum arquivo externo).
import { useMemo } from "react";
import * as THREE from "three";
import { Environment, Lightformer, Sky, Stars } from "@react-three/drei";

export type Horario = { noite: number; sol: THREE.Vector3; corSol: THREE.Color; forcaSol: number; corCeu: THREE.Color; forcaCeu: number; fundo: THREE.Color };

const mistura = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), Math.min(1, Math.max(0, t)));

/** Estado da luz para a posição `t` do controle (0 manhã · 0,5 pôr do sol · 1 noite). */
export function horarioEm(t: number): Horario {
  const tarde = Math.min(1, t / 0.5), anoitecer = Math.max(0, (t - 0.5) / 0.5);
  // Altura do sol: 55° de manhã, 6° no pôr do sol, abaixo do horizonte à noite. Azimute gira de leste a oeste.
  const altura = THREE.MathUtils.degToRad(t <= 0.5 ? 55 - 49 * tarde : 6 - 26 * anoitecer);
  const azimute = THREE.MathUtils.degToRad(-60 + 150 * Math.min(1, t / 0.6));
  const sol = new THREE.Vector3(Math.cos(altura) * Math.sin(azimute), Math.sin(altura), Math.cos(altura) * Math.cos(azimute));
  const noite = THREE.MathUtils.smoothstep(t, 0.55, 0.9);
  return {
    noite, sol,
    corSol: t <= 0.5 ? mistura("#FFF4E0", "#FF9A4D", tarde * tarde) : mistura("#FF9A4D", "#5B6FA8", anoitecer),
    forcaSol: t <= 0.5 ? 2.1 - 0.7 * tarde : Math.max(0.1, 1.4 * (1 - anoitecer * 1.3)),
    corCeu: t <= 0.5 ? mistura("#DCEBFF", "#FFC79A", tarde) : mistura("#FFC79A", "#2A3558", anoitecer),
    forcaCeu: t <= 0.5 ? 0.5 - 0.12 * tarde : 0.38 - 0.24 * anoitecer,
    fundo: t <= 0.5 ? mistura("#BFD9F2", "#F2B98A", tarde) : mistura("#F2B98A", "#0B1022", anoitecer),
  };
}

export function Ceu({ t, raio, centro, sombras, mapaSombra }: { t: number; raio: number; centro: [number, number, number]; sombras: boolean; mapaSombra: number }) {
  const h = useMemo(() => horarioEm(t), [t]);
  const alcance = Math.max(12, raio * 1.6);
  const posicao = useMemo(() => h.sol.clone().multiplyScalar(alcance * 2).add(new THREE.Vector3(...centro)), [h, alcance, centro]);
  return (
    <>
      <color attach="background" args={[h.fundo]} />
      <fog attach="fog" args={[h.fundo, alcance * 6, alcance * 30]} />
      {h.noite < 0.85 && <Sky distance={1500} sunPosition={h.sol} turbidity={t > 0.3 ? 9 : 4} rayleigh={t > 0.3 ? 2.6 : 1.2} mieCoefficient={0.006} mieDirectionalG={0.85} />}
      {h.noite > 0.4 && <Stars radius={300} depth={40} count={1500} factor={5} fade speed={0.4} />}
      <hemisphereLight args={[h.corCeu, "#6B5D4D", h.forcaCeu]} />
      <ambientLight intensity={0.06 + h.noite * 0.08} color={h.noite > 0.5 ? "#8FA0D0" : "#FFFFFF"} />
      <directionalLight
        position={posicao} target-position={centro} color={h.corSol} intensity={h.forcaSol} castShadow={sombras}
        shadow-mapSize={[mapaSombra, mapaSombra]} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-camera-left={-alcance} shadow-camera-right={alcance} shadow-camera-top={alcance} shadow-camera-bottom={-alcance}
        shadow-camera-near={0.5} shadow-camera-far={alcance * 5}
      />
      {/* Ambiente para reflexos: painéis claros em volta, mais quentes ao entardecer e escuros à noite. */}
      <Environment resolution={64} frames={1} key={Math.round(t * 8)}>
        <color attach="background" args={[h.fundo]} />
        <Lightformer form="rect" intensity={0.9 * (1 - h.noite * 0.9)} color={h.corCeu} position={[0, 8, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[30, 30, 1]} />
        <Lightformer form="rect" intensity={0.8 * (1 - h.noite * 0.9)} color={h.corSol} position={[h.sol.x * 10, Math.max(1, h.sol.y * 10), h.sol.z * 10]} scale={[10, 10, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.25 + h.noite * 0.3} color="#FFE2B8" position={[0, 1, -8]} scale={[12, 4, 1]} />
      </Environment>
    </>
  );
}
