import { NumeroInput } from "@/components/ui/numero-input";

// Campo de dinheiro "R$ 1.000.000,00" (pedido de 15/10; correção 21/AD-01).
// Desde 27/10 é um wrapper do `NumeroInput` (máscara pt-BR única, cursor
// estável, colagem de "R$ 1.234,56") — API pública e unidade armazenada
// inalteradas: o número entregue é o mesmo que o formulário já guardava.
// Equivalente ao `CurrencyInput` do Grupo Santa Fé
// (`web/src/components/ui/currency-input.tsx`). Dois padrões de formulário:
//
//  - Controlado (`value`/`onChange`): formulários que mantêm o número em
//    estado React (ex.: incorporação).
//  - Não controlado (`name`/`defaultValue`): formulários que leem os dados
//    via `FormData` no submit (ex.: `AdminFinanciamentos`, `AdminComissoes`)
//    — um `<input type="hidden">` com o número cru é renderizado junto.
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
      prefixo="R$"
      casas={2}
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
