import type { Imovel } from "../../drizzle/schema";

/**
 * Geração dos feeds XML de imóveis por portal (ZAP, OLX, VivaReal, Chaves na
 * Mão), espelhando o formato usado pelo Grupo Santa Fé
 * (web/src/app/api/feed/{zap,olx,vivareal,chavesnamao}/route.ts).
 *
 * Prospecta não tem os campos `condominio`/`iptu`/`suites`/`cep` que o
 * Santa Fé tem — os trechos condicionais desses campos são simplesmente
 * omitidos (nunca inventados).
 */

function parseImagens(fotos: string | null): string[] {
  if (!fotos) return [];
  try {
    const parsed = JSON.parse(fotos);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const TIPO_ZAP: Record<string, string> = {
  casa: "Home",
  apartamento: "Apartment",
  lote: "Lot",
  terreno: "Lot",
  comercial: "Commercial Premises",
  chacara: "Farm",
};

const TIPO_VIVAREAL: Record<string, string> = {
  casa: "Casa",
  apartamento: "Apartamento",
  lote: "Terreno / Lote",
  terreno: "Terreno / Lote",
  comercial: "Sala Comercial",
  chacara: "Sítio / Chácara",
};

const TIPO_CHAVESNAMAO: Record<string, string> = {
  casa: "Casa",
  apartamento: "Apartamento",
  lote: "Terreno/Lote",
  terreno: "Terreno/Lote",
  comercial: "Comercial/Industrial",
  chacara: "Chácara/Sítio/Fazenda",
};

function olxCategoryCode(tipo: string, status: string): string {
  if (status === "alugado") return "2040";
  const map: Record<string, string> = {
    casa: "2020",
    apartamento: "2030",
    lote: "2060",
    terreno: "2060",
    comercial: "2080",
    chacara: "2070",
  };
  return map[tipo] ?? "2020";
}

function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const XML_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400",
} as const;

export { XML_HEADERS };

export function gerarFeedZap(imoveis: Imovel[], siteUrl: string): string {
  const items = imoveis
    .map((p) => {
      const imagens = parseImagens(p.fotos);
      return `    <Listing>
      <ListingID>${p.id}</ListingID>
      <Title><![CDATA[${p.titulo}]]></Title>
      <TransactionType>${p.status === "alugado" ? "For Rent" : "For Sale"}</TransactionType>
      <ListingType>Standard</ListingType>
      <Category>Residential</Category>
      <PropertyType>${TIPO_ZAP[p.tipo] ?? "Home"}</PropertyType>
      <OwnerListingID>${p.slug}</OwnerListingID>
      <Address>
        <Country>BR</Country>
        <State>${escapeXmlAttr(p.estado ?? "")}</State>
        <City>${escapeXmlAttr(p.cidade)}</City>
        <Neighborhood>${escapeXmlAttr(p.bairro ?? "")}</Neighborhood>
        <StreetName><![CDATA[${p.endereco ?? ""}]]></StreetName>
      </Address>
      <ContactInfo>
        <Name>Prospecta</Name>
        <Website>${siteUrl}</Website>
      </ContactInfo>
      <Details>
        <PropertyDetails>
          <LivingArea unit="square metres">${p.areaM2 ?? 0}</LivingArea>${p.quartos != null ? `\n          <Bedrooms>${p.quartos}</Bedrooms>` : ""}${p.banheiros != null ? `\n          <Bathrooms>${p.banheiros}</Bathrooms>` : ""}${p.vagas != null ? `\n          <Parking>${p.vagas}</Parking>` : ""}
        </PropertyDetails>
      </Details>
      <ListPrice currency="BRL">${p.preco}</ListPrice>
      <Description><![CDATA[${p.descricao ?? ""}]]></Description>
      <PropertyURL>${siteUrl}/imoveis/${p.slug}</PropertyURL>
      <Media>
${imagens.length > 0 ? imagens.map((img) => `        <Item medium="image"><![CDATA[${img}]]></Item>`).join("\n") : ""}
      </Media>
      <DatePosted>${p.createdAt.toISOString()}</DatePosted>
      <LastUpdated>${p.updatedAt.toISOString()}</LastUpdated>
    </Listing>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListingDataFeed xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Listings>
${items}
  </Listings>
</ListingDataFeed>`;
}

export function gerarFeedVivaReal(imoveis: Imovel[], siteUrl: string): string {
  const items = imoveis
    .map((p) => {
      const imagens = parseImagens(p.fotos);
      return `    <Listing>
      <ListingID>VR-${p.id}</ListingID>
      <Title><![CDATA[${p.titulo}]]></Title>
      <TransactionType>${p.status === "alugado" ? "For Rent" : "For Sale"}</TransactionType>
      <ListingType>Standard</ListingType>
      <Category>Residential</Category>
      <PropertyType>${TIPO_VIVAREAL[p.tipo] ?? "Casa"}</PropertyType>
      <OwnerListingID>${p.slug}</OwnerListingID>
      <Address>
        <Country>BR</Country>
        <State>${escapeXmlAttr(p.estado ?? "")}</State>
        <City>${escapeXmlAttr(p.cidade)}</City>
        <Neighborhood>${escapeXmlAttr(p.bairro ?? "")}</Neighborhood>
        <StreetName><![CDATA[${p.endereco ?? ""}]]></StreetName>
      </Address>
      <ContactInfo>
        <Name>Prospecta</Name>
        <Website>${siteUrl}</Website>
      </ContactInfo>
      <Details>
        <PropertyDetails>
          <LivingArea unit="square metres">${p.areaM2 ?? 0}</LivingArea>${p.quartos != null ? `\n          <Bedrooms>${p.quartos}</Bedrooms>` : ""}${p.banheiros != null ? `\n          <Bathrooms>${p.banheiros}</Bathrooms>` : ""}${p.vagas != null ? `\n          <Parking>${p.vagas}</Parking>` : ""}
        </PropertyDetails>
      </Details>
      <ListPrice currency="BRL">${p.preco}</ListPrice>
      <Description><![CDATA[${p.descricao ?? ""}]]></Description>
      <PropertyURL>${siteUrl}/imoveis/${p.slug}</PropertyURL>
      <Media>
${imagens.length > 0 ? imagens.map((img) => `        <Item medium="image"><![CDATA[${img}]]></Item>`).join("\n") : ""}
      </Media>
      <DatePosted>${p.createdAt.toISOString()}</DatePosted>
      <LastUpdated>${p.updatedAt.toISOString()}</LastUpdated>
    </Listing>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ListingDataFeed xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Listings>
${items}
  </Listings>
</ListingDataFeed>`;
}

export function gerarFeedOlx(imoveis: Imovel[], siteUrl: string): string {
  const items = imoveis
    .map((p) => {
      const imagens = parseImagens(p.fotos);
      return `  <advert>
    <id><![CDATA[PROS-${p.id}]]></id>
    <url>${siteUrl}/imoveis/${p.slug}</url>
    <title><![CDATA[${p.titulo}]]></title>
    <body><![CDATA[${p.descricao ?? ""}]]></body>
    <category>${olxCategoryCode(p.tipo, p.status)}</category>
    <price>${p.preco}</price>
    <price_type>fixed</price_type>
    <currency>BRL</currency>
    <images>
${imagens.length > 0 ? imagens.map((img) => `      <image><![CDATA[${img}]]></image>`).join("\n") : ""}
    </images>
    <params>
${p.quartos != null ? `      <param name="rooms">${p.quartos}</param>\n` : ""}${p.banheiros != null ? `      <param name="bathrooms">${p.banheiros}</param>\n` : ""}${p.vagas != null ? `      <param name="garage_spaces">${p.vagas}</param>\n` : ""}      <param name="size">${p.areaM2 ?? 0}</param>
    </params>
    <locations>
      <location>
        <country name="Brasil">BR</country>
        <region name="${escapeXmlAttr(p.estado ?? "")}">${escapeXmlAttr(p.estado ?? "")}</region>
        <city name="${escapeXmlAttr(p.cidade)}">${escapeXmlAttr(p.cidade)}</city>
        <suburb name="${escapeXmlAttr(p.bairro ?? "")}">${escapeXmlAttr(p.bairro ?? "")}</suburb>
        <street><![CDATA[${p.endereco ?? ""}]]></street>
      </location>
    </locations>
    <contact>
      <name><![CDATA[Prospecta]]></name>
    </contact>
    <date_created>${p.createdAt.toISOString()}</date_created>
  </advert>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<adverts>
${items}
</adverts>`;
}

export function gerarFeedChavesNaMao(imoveis: Imovel[], siteUrl: string): string {
  const items = imoveis
    .map((p) => {
      const imagens = parseImagens(p.fotos);
      return `  <imovel>
    <id>${p.id}</id>
    <tipo>${TIPO_CHAVESNAMAO[p.tipo] ?? "Casa"}</tipo>
    <subtipo>${p.status === "alugado" ? "Aluguel" : "Venda"}</subtipo>
    <titulo><![CDATA[${p.titulo}]]></titulo>
    <descricao><![CDATA[${p.descricao ?? ""}]]></descricao>
    <preco>${p.preco}</preco>
    <area_util>${p.areaM2 ?? 0}</area_util>${p.quartos != null ? `\n    <dormitorios>${p.quartos}</dormitorios>` : ""}${p.banheiros != null ? `\n    <banheiros>${p.banheiros}</banheiros>` : ""}${p.vagas != null ? `\n    <vagas>${p.vagas}</vagas>` : ""}
    <logradouro><![CDATA[${p.endereco ?? ""}]]></logradouro>
    <bairro><![CDATA[${p.bairro ?? ""}]]></bairro>
    <cidade><![CDATA[${p.cidade}]]></cidade>
    <estado>${escapeXmlAttr(p.estado ?? "")}</estado>
    <url>${siteUrl}/imoveis/${p.slug}</url>
    <fotos>
${imagens.length > 0 ? imagens.map((img) => `      <foto><![CDATA[${img}]]></foto>`).join("\n") : ""}
    </fotos>
  </imovel>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<imoveis>
${items}
</imoveis>`;
}
