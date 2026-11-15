// Maquete 3D (EPIC-022) — modo aprimorado (botão "Aprimorar"): troca o desenho direto por uma sequência de
// passes que aproxima a imagem de um render — oclusão de ambiente (as quinas, os pés dos móveis e os encontros
// de parede escurecem como na vida real), brilho suave nas luzes acesas e suavização de serrilhado.
// Usa só os passes que já vêm com o three.js. Também fornece a foto em alta resolução da vista atual.
import { useEffect, useMemo, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";

/** Função que tira a foto da vista atual e devolve a imagem (PNG) pronta para baixar. */
export type Fotografo = MutableRefObject<(() => Promise<Blob | null>) | null>;

export function Aprimorado({ ativo, noite, fotografo }: { ativo: boolean; noite: number; fotografo: Fotografo }) {
  const { gl, scene, camera, size } = useThree();

  const passes = useMemo(() => {
    if (!ativo) return null;
    const alvo = new THREE.WebGLRenderTarget(size.width, size.height, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(gl, alvo);
    composer.addPass(new RenderPass(scene, camera));
    const oclusao = new GTAOPass(scene, camera, size.width, size.height);
    oclusao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.2, thickness: 1.2, scale: 1.15, samples: 16 });
    oclusao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    composer.addPass(oclusao);
    const brilho = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.12, 0.6, 0.92);
    composer.addPass(brilho);
    composer.addPass(new OutputPass());
    composer.addPass(new SMAAPass());
    return { composer, brilho };
    // O compositor é recriado só ao ligar/desligar; o tamanho é ajustado no efeito abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, gl, scene, camera]);

  useEffect(() => {
    if (!passes) return;
    passes.composer.setPixelRatio(gl.getPixelRatio());
    passes.composer.setSize(size.width, size.height);
  }, [passes, size.width, size.height, gl]);
  useEffect(() => { if (passes) passes.brilho.strength = 0.1 + noite * 0.35; }, [passes, noite]);
  useEffect(() => () => { passes?.composer.dispose(); }, [passes]);

  // Com prioridade > 0 este quadro substitui o desenho padrão do react-three-fiber.
  useFrame((_, dt) => { passes?.composer.render(dt); }, ativo ? 1 : 0);

  // Foto: redesenha a mesma vista com o triplo dos pixels (limitado pelo aparelho) e devolve o PNG.
  useEffect(() => {
    fotografo.current = async () => {
      const antes = gl.getPixelRatio(), maximo = gl.capabilities.maxTextureSize;
      const fator = Math.max(1, Math.min(3, Math.floor(maximo / Math.max(size.width, size.height))));
      try {
        gl.setPixelRatio(fator);
        if (passes) { passes.composer.setPixelRatio(fator); passes.composer.setSize(size.width, size.height); passes.composer.render(0); }
        else gl.render(scene, camera);
        return await new Promise<Blob | null>(pronto => gl.domElement.toBlob(pronto, "image/png"));
      } finally {
        gl.setPixelRatio(antes);
        if (passes) { passes.composer.setPixelRatio(antes); passes.composer.setSize(size.width, size.height); }
      }
    };
    return () => { fotografo.current = null; };
  }, [fotografo, gl, scene, camera, size.width, size.height, passes]);

  return null;
}
