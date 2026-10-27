import { NumeroInput } from "@/components/ui/numero-input";

// Campo de percentual com sufixo "%". Desde 27/10 (correção 21/AD-01) é um
// wrapper do `NumeroInput` — API pública inalterada.
//
// Importante: o número que entra/sai deste componente está na MESMA
// escala em que o campo já guardava o valor — este componente não
// multiplica nem divide por 100. Ex.: um campo que guarda `6` para "6%"
// continua recebendo/entregando `6`; um campo que guarda a fração `0.06`
// continua recebendo/entregando `0.06` (o sufixo "%" é só cosmético).
// Percentual: ponto é decimal ("2.345" = 2,345%), igual ao Santa Fé.
type PercentInputProps = {
  className?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  /** Casas decimais aceitas/exibidas (padrão 2; índices usam 4). */
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
  const modo = controlado
    ? {
        value: Number.isFinite((resto as { value: number }).value) ? (resto as { value: number }).value : 0,
        onChange: (v: number | null) => (resto as { onChange: (v: number) => void }).onChange(v ?? 0),
      }
    : { defaultValue: (resto as { defaultValue?: number | null }).defaultValue ?? 0 };

  return (
    <NumeroInput
      {...modo}
      id={id}
      name={"name" in resto ? resto.name : undefined}
      valorOcultoVazio="0"
      sufixo="%"
      casas={maximumFractionDigits}
      casasMinimas={Math.min(2, maximumFractionDigits)}
      pontoDecimal
      vazioQuandoZero
      onBlurValue={onBlurValue ? v => onBlurValue(v ?? 0) : undefined}
      placeholder={placeholder ?? "0,00"}
      required={required}
      disabled={disabled}
      aria-label={props["aria-label"]}
      className={className}
    />
  );
}
