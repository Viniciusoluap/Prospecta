export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const APP_TITLE = import.meta.env.VITE_APP_TITLE || "App";

export const APP_LOGO = "https://placehold.co/128x128/2C5F2D/FFD700?text=Efficaz";

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};

// Product categories
export const PRODUCT_CATEGORIES = {
  real_estate: {
    label: "Construção Civil",
    description: "Imóveis e projetos imobiliários",
    icon: "🏗️",
  },
  financial: {
    label: "Financeira",
    description: "Serviços financeiros e crédito",
    icon: "💰",
  },
  nautical: {
    label: "Náutico",
    description: "Embarcações e serviços náuticos",
    icon: "⛵",
  },
} as const;

// Format currency in BRL
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

// Format UTEF amount (1 UTEF = R$ 1,00)
export function formatUtef(amount: number, showEquivalent: boolean = true): string {
  const formatted = `${amount.toLocaleString("pt-BR")} UTEF`;
  if (showEquivalent) {
    const reais = formatCurrency(amount * 100); // amount * 100 porque formatCurrency espera centavos
    return `${formatted} (${reais})`;
  }
  return formatted;
}

// Format date
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}
