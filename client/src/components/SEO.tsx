import { useEffect } from "react";
import { APP_TITLE } from "@/const";

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
  type?: "website" | "article" | "product";
  schema?: Record<string, any>;
}

export default function SEO({
  title,
  description = "Prospecta Empreendimentos - Construímos a casa dos seus sonhos com financiamento desde o terreno até a construção. Participe do Ecossistema Efficaz com sorteios, UTEFs e produtos exclusivos.",
  keywords = "construção civil, financiamento imobiliário, projetos arquitetônicos, sorteios, UTEFs, imóveis, Imperatriz MA, Prospecta Empreendimentos",
  image = "https://efficazorbit.com/og-image.jpg",
  url,
  type = "website",
  schema,
}: SEOProps) {
  const fullTitle = title ? `${title} | ${APP_TITLE}` : APP_TITLE;
  const currentUrl = url || (typeof window !== "undefined" ? window.location.href : "https://efficazorbit.com");

  useEffect(() => {
    // Update document title
    document.title = fullTitle;

    // Update or create meta tags
    const updateMetaTag = (name: string, content: string, isProperty = false) => {
      const attribute = isProperty ? "property" : "name";
      let element = document.querySelector(`meta[${attribute}="${name}"]`);
      
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attribute, name);
        document.head.appendChild(element);
      }
      
      element.setAttribute("content", content);
    };

    // Basic meta tags
    updateMetaTag("description", description);
    updateMetaTag("keywords", keywords);

    // Open Graph tags
    updateMetaTag("og:title", fullTitle, true);
    updateMetaTag("og:description", description, true);
    updateMetaTag("og:image", image, true);
    updateMetaTag("og:url", currentUrl, true);
    updateMetaTag("og:type", type, true);
    updateMetaTag("og:site_name", APP_TITLE, true);

    // Twitter Card tags
    updateMetaTag("twitter:card", "summary_large_image");
    updateMetaTag("twitter:title", fullTitle);
    updateMetaTag("twitter:description", description);
    updateMetaTag("twitter:image", image);

    // Schema.org JSON-LD
    if (schema) {
      let scriptElement = document.querySelector('script[type="application/ld+json"]');
      
      if (!scriptElement) {
        scriptElement = document.createElement("script");
        scriptElement.setAttribute("type", "application/ld+json");
        document.head.appendChild(scriptElement);
      }
      
      scriptElement.textContent = JSON.stringify(schema);
    }
  }, [fullTitle, description, keywords, image, currentUrl, type, schema]);

  return null;
}

// Predefined schemas
export const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Prospecta Empreendimentos",
  legalName: "Prospecta Empreendimentos LTDA",
  url: "https://efficazorbit.com",
  logo: "https://efficazorbit.com/logo.png",
  foundingDate: "2020",
  contactPoint: {
    "@type": "ContactPoint",
    telephone: "+55-99-98139-2210",
    contactType: "Customer Service",
    areaServed: "BR",
    availableLanguage: "Portuguese"
  },
  address: {
    "@type": "PostalAddress",
    streetAddress: "Leôncio Pires Dourado, 840A - Bacuri",
    addressLocality: "Imperatriz",
    addressRegion: "MA",
    postalCode: "65900-000",
    addressCountry: "BR"
  },
  sameAs: [
    "https://www.instagram.com/prospecta.empreendimentos"
  ]
};

export const localBusinessSchema = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: "Prospecta Empreendimentos",
  image: "https://efficazorbit.com/logo.png",
  "@id": "https://efficazorbit.com",
  url: "https://efficazorbit.com",
  telephone: "+55-99-98139-2210",
  priceRange: "$$",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Leôncio Pires Dourado, 840A - Bacuri",
    addressLocality: "Imperatriz",
    addressRegion: "MA",
    postalCode: "65900-000",
    addressCountry: "BR"
  },
  geo: {
    "@type": "GeoCoordinates",
    latitude: -5.5263,
    longitude: -47.4791
  },
  openingHoursSpecification: {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday"
    ],
    opens: "08:00",
    closes: "18:00"
  }
};
