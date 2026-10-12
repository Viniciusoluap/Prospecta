import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatarNumeroParaEdicao, aplicarDigitacao } from "@/lib/numero-input";

// Campo de dinheiro com entrada por vírgula (padrão brasileiro) e prefixo
// "R$". Mesma lógica de buffer de texto usada em
// `client/src/components/incorporacao/EstudoMassa.tsx` (Lote 5): o
// `<input>` nunca é vinculado diretamente ao número — senão, cada tecla
// reformataria o valor e apagaria a vírgula decimal que o usuário está
// digitando. Equivalente ao `CurrencyInput` do Grupo Santa Fé
// (`web/src/components/ui/currency-input.tsx`), adaptado para os dois
// padrões de formulário deste repositório:
//
//  - Controlado (`value`/`onChange`): usado pelos formulários de
//    incorporação, que já mantêm o número em estado React (ex.:
//    `EstudoMassa.tsx`).
//  - Não controlado (`name`/`defaultValue`): usado pelos formulários que
//    leem os dados via `FormData` no submit (ex.: `AdminFinanciamentos`,
//    `AdminComissoes`) — um `<input type="hidden">` com o número cru é
//    renderizado junto, para `FormData.get(name)` continuar funcionando
//    sem reescrever esses formulários.
type CurrencyInputProps = {
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  // Opcional: disparado no blur com o número final já convertido — para o
  // padrão "commita só ao sair do campo" (ex.: `onBlur={(v) =>
  // mutation.mutate({ valor: v })}` em vez de mutar a cada tecla).
  onBlurValue?: (value: number) => void;
} & (
  | { value: number; onChange: (value: number) => void; name?: string; defaultValue?: never }
  // `name` é opcional: só é preciso quando o valor precisa viajar por
  // `FormData` (ver `name` acima). Sem `name`, use `onBlurValue` para ler
  // o número final (ex.: mutação disparada só ao sair do campo).
  | { name?: string; defaultValue?: number | null; value?: never; onChange?: never }
);

export function CurrencyInput(props: CurrencyInputProps) {
  const { className, placeholder, required, disabled, id, onBlurValue, ...resto } = props;
  const controlado = "onChange" in resto && typeof resto.onChange === "function";
  const valorInicial = controlado ? (resto as { value: number }).value : (resto as { defaultValue?: number | null }).defaultValue ?? 0;

  const [numero, setNumero] = useState<number>(() => (Number.isFinite(valorInicial) ? valorInicial : 0));
  const [texto, setTexto] = useState<string>(() => formatarNumeroParaEdicao(valorInicial));

  // Modo controlado: se o valor externo mudar por outra via (ex.: dados
  // carregados do servidor depois do primeiro render), ressincroniza o
  // buffer — mas nunca durante a digitação do próprio campo (aí o número
  // já bate com `value`, então o efeito não dispara).
  const valorControlado = controlado ? (resto as { value: number }).value : undefined;
  useEffect(() => {
    if (valorControlado === undefined) return;
    if (Number.isFinite(valorControlado) && valorControlado !== numero) {
      setNumero(valorControlado);
      setTexto(formatarNumeroParaEdicao(valorControlado));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valorControlado]);

  function onChangeTexto(valorTexto: string) {
    const { texto: novoTexto, numero: novoNumero } = aplicarDigitacao(valorTexto);
    setTexto(novoTexto);
    setNumero(novoNumero);
    if (controlado) (resto as { onChange: (v: number) => void }).onChange(novoNumero);
  }

  function onBlur() {
    setTexto(formatarNumeroParaEdicao(numero));
    onBlurValue?.(numero);
  }

  const name = "name" in resto ? resto.name : undefined;

  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
        R$
      </span>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={texto}
        onChange={e => onChangeTexto(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder ?? "0,00"}
        required={required}
        disabled={disabled}
        aria-label={props["aria-label"]}
        className={cn("pl-9", className)}
      />
      {name && <input type="hidden" name={name} value={numero} />}
    </div>
  );
}
