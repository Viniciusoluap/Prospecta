// EPIC-029 S-1 — preenchimento automático por CNPJ e CEP nas telas de cadastro que já existem.
// Ao completar 14 caracteres de CNPJ válido (ou 8 números de CEP), consulta o servidor UMA vez por documento, preenche só
// os campos VAZIOS e guarda os que o usuário já digitou com outro valor como "conflitos" — esses só mudam pelo botão
// "Usar dados da Receita". CPF não consulta nada (11 números nunca chegam aqui como CNPJ).
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  cepParaConsulta, cnpjParaConsulta, separarPreenchimento,
  type DadosCep, type DadosCnpj,
} from "@shared/consulta-cadastral";

export type EstadoConsulta<T> = {
  situacao: "ocioso" | "consultando" | "pronto" | "erro";
  dados: T | null;
  mensagem: string | null;
  alerta: string | null;
  /** Quantos campos vazios foram preenchidos na última consulta. */
  preenchidos: number;
  conflitos: Record<string, string>;
  usarDados: () => void;
  descartar: () => void;
};

type Opcoes<K extends string, T> = {
  tipo: "cnpj" | "cep";
  valor: string;
  /** Valores atuais dos campos que a consulta pode preencher. */
  campos: Partial<Record<K, string | null | undefined>>;
  mapear: (dados: T) => Partial<Record<K, string | null | undefined>>;
  aplicar: (patch: Partial<Record<K, string>>) => void;
  /** Desliga a consulta (ex.: cadastro que vem do CRM, com campos travados). */
  desligado?: boolean;
  /** Documento já salvo no cadastro aberto para edição: não consulta de novo só por abrir a tela. */
  ignorar?: string | null;
};

function useAutoPreenchimento<K extends string, T extends DadosCnpj | DadosCep>(o: Opcoes<K, T>): EstadoConsulta<T> {
  const cnpj = trpc.consultaCadastral.cnpj.useMutation();
  const cep = trpc.consultaCadastral.cep.useMutation();
  const [estado, setEstado] = useState<Omit<EstadoConsulta<T>, "usarDados" | "descartar">>({
    situacao: "ocioso", dados: null, mensagem: null, alerta: null, preenchidos: 0, conflitos: {},
  });
  const ultimo = useRef<string | null>(null);
  const atual = useRef(o);
  atual.current = o;

  const consultar = o.tipo === "cnpj" ? cnpjParaConsulta : cepParaConsulta;
  const doc = o.desligado ? null : consultar(o.valor);
  const chave = doc && doc === (o.ignorar ? consultar(o.ignorar) : null) ? null : doc;

  useEffect(() => {
    if (!chave) {
      // Documento apagado ou incompleto: some o aviso da consulta anterior.
      ultimo.current = null;
      setEstado(e => e.situacao === "ocioso" ? e : { situacao: "ocioso", dados: null, mensagem: null, alerta: null, preenchidos: 0, conflitos: {} });
      return;
    }
    if (ultimo.current === chave) return;
    ultimo.current = chave;
    let cancelado = false;
    setEstado(e => ({ ...e, situacao: "consultando", mensagem: null, alerta: null, conflitos: {} }));
    const chamada = atual.current.tipo === "cnpj" ? cnpj.mutateAsync({ cnpj: chave }) : cep.mutateAsync({ cep: chave });
    chamada.then(r => {
      if (cancelado || ultimo.current !== chave) return;
      if (!r.ok) { setEstado({ situacao: "erro", dados: null, mensagem: r.mensagem, alerta: null, preenchidos: 0, conflitos: {} }); return; }
      const dados = r.dados as T;
      const { vazios, conflitos } = separarPreenchimento(atual.current.campos, atual.current.mapear(dados));
      const n = Object.keys(vazios).length;
      if (n) atual.current.aplicar(vazios);
      setEstado({
        situacao: "pronto", dados, alerta: "alerta" in dados ? dados.alerta : null, preenchidos: n,
        conflitos: conflitos as Record<string, string>,
        mensagem: n ? `${n} campo(s) vazio(s) preenchido(s) com a consulta pública.` : "Consulta feita: os campos já estavam preenchidos.",
      });
    }).catch((e: unknown) => {
      if (cancelado || ultimo.current !== chave) return;
      // Limite por minuto, sem permissão ou rede fora: o cadastro continua à mão.
      const mensagem = e instanceof Error && e.message ? e.message : "Não foi possível consultar agora. Preencha os campos à mão.";
      ultimo.current = null;
      setEstado({ situacao: "erro", dados: null, mensagem, alerta: null, preenchidos: 0, conflitos: {} });
    });
    return () => { cancelado = true; if (ultimo.current === chave) ultimo.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  return {
    ...estado,
    usarDados: () => {
      if (Object.keys(estado.conflitos).length) atual.current.aplicar(estado.conflitos as Partial<Record<K, string>>);
      setEstado(e => ({ ...e, conflitos: {}, mensagem: "Dados da consulta pública aplicados." }));
    },
    descartar: () => setEstado(e => ({ ...e, conflitos: {} })),
  };
}

export function useAutoPreenchimentoCnpj<K extends string>(o: Omit<Opcoes<K, DadosCnpj>, "tipo">) {
  return useAutoPreenchimento<K, DadosCnpj>({ ...o, tipo: "cnpj" });
}

export function useAutoPreenchimentoCep<K extends string>(o: Omit<Opcoes<K, DadosCep>, "tipo">) {
  return useAutoPreenchimento<K, DadosCep>({ ...o, tipo: "cep" });
}
