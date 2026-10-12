import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatarNumeroParaEdicao, aplicarDigitacao } from "@/lib/numero-input";

// Campo de percentual com entrada por vírgula e sufixo "%". Mesmo padrão
// de buffer de texto do `CurrencyInput` (ver esse arquivo para o porquê).
//
// Importante: o número que entra/sai deste componente está na MESMA
// escala em que o campo já guardava o valor antes da migração — este
// componente não multiplica nem divide por 100. Ex.: um campo que hoje
// guarda `6` para "6%" continua recebendo/entregando `6`; um campo que
// guarda a fração `0.06` continua recebendo/entregando `0.06` (e nesse
// caso o sufixo "%" é só cosmético — quem chama decide a escala, igual
// já decidia com o `<input type="number">` anterior).
type PercentInputProps = {
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  maximumFractionDigits?: number;
  // Opcional: disparado no blur com o número final já convertido — mesmo
  // propósito do `onBlurValue` do `CurrencyInput`.
  onBlurValue?: (value: number) => void;
} & (
  | { value: number; onChange: (value: number) => void; name?: string; defaultValue?: never }
  // `name` é opcional: só é preciso quando o valor precisa viajar por
  // `FormData`. Sem `name`, use `onBlurValue` para ler o número final.
  | { name?: string; defaultValue?: number | null; value?: never; onChange?: never }
);

export function PercentInput(props: PercentInputProps) {
  const { className, placeholder, required, disabled, id, maximumFractionDigits = 2, onBlurValue, ...resto } = props;
  const controlado = "onChange" in resto && typeof resto.onChange === "function";
  const valorInicial = controlado ? (resto as { value: number }).value : (resto as { defaultValue?: number | null }).defaultValue ?? 0;

  const [numero, setNumero] = useState<number>(() => (Number.isFinite(valorInicial) ? valorInicial : 0));
  const [texto, setTexto] = useState<string>(() => formatarNumeroParaEdicao(valorInicial, { maximumFractionDigits }));

  const valorControlado = controlado ? (resto as { value: number }).value : undefined;
  useEffect(() => {
    if (valorControlado === undefined) return;
    if (Number.isFinite(valorControlado) && valorControlado !== numero) {
      setNumero(valorControlado);
      setTexto(formatarNumeroParaEdicao(valorControlado, { maximumFractionDigits }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valorControlado]);

  function onChangeTexto(valorTexto: string) {
    const { texto: novoTexto, numero: novoNumero } = aplicarDigitacao(valorTexto, { percentual: true });
    setTexto(novoTexto);
    setNumero(novoNumero);
    if (controlado) (resto as { onChange: (v: number) => void }).onChange(novoNumero);
  }

  function onBlur() {
    setTexto(formatarNumeroParaEdicao(numero, { maximumFractionDigits }));
    onBlurValue?.(numero);
  }

  const name = "name" in resto ? resto.name : undefined;

  return (
    <div className="relative">
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
        className={cn("pr-7", className)}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
        %
      </span>
      {name && <input type="hidden" name={name} value={numero} />}
    </div>
  );
}
