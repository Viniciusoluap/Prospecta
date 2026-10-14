// Equivalente ao `next/dynamic` usado pelo Santa Fé para carregar mapas e o 3D
// só no navegador: o Prospecta é SPA, então basta o carregamento sob demanda.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

export default function dynamic<P extends object>(
  carregar: () => Promise<ComponentType<P> | { default: ComponentType<P> }>,
  opcoes?: { ssr?: boolean; loading?: () => ReactNode },
): ComponentType<P> {
  const Lazy = lazy(async () => {
    const m = await carregar();
    return "default" in (m as object) ? (m as { default: ComponentType<P> }) : { default: m as ComponentType<P> };
  });
  return function Dinamico(props: P) {
    return <Suspense fallback={opcoes?.loading?.() ?? null}><Lazy {...props} /></Suspense>;
  };
}
