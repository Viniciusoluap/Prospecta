import { drizzle } from "drizzle-orm/mysql2";
import { products } from "./drizzle/schema.js";
import { eq } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL);

console.log("🗑️  Removendo produtos antigos...");
await db.delete(products);

console.log("✅ Inserindo produtos corretos...");

// 1. Prospecta Construções - Casa Padrão 47m²
await db.insert(products).values({
  category: "real_estate",
  title: "Casa Padrão 47m² - Prospecta Construções",
  description:
    "Casa térrea completa de 47m² com financiamento facilitado pela Caixa Econômica Federal. Acabamento de primeira qualidade, projetos personalizados. 2 quartos, sala, cozinha, banheiro e área de serviço. Parcelas mais baratas que aluguel!",
  priceUtef: 180000,
  imageUrl:
    "https://prospectaconstrucoes.com/wp-content/uploads/2024/01/planta-casa-150m2-1o-piso.jpg",
  isActive: true,
});

// 2. Efficaz Financeira - Crédito 0,35%
await db.insert(products).values({
  category: "financial",
  title: "Crédito UTEF 0,35% - Financiamento Habitacional",
  description:
    "Ao financiar seu imóvel com o Grupo Efficaz, você recebe 0,35% do valor financiado em tokens UTEF! Exemplo: Financiamento de R$ 180.000 = 630 UTEF de bônus. Use seus tokens para adquirir outros produtos do ecossistema.",
  priceUtef: 0, // Produto especial, não tem preço fixo
  imageUrl: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800",
  isActive: true,
});

// 3. Exclusive Clubitz - Lancha Focker 215
await db.insert(products).values({
  category: "nautical",
  title: "Lancha Focker 215 Cabinada 150 HP - Compartilhamento",
  description:
    "Cota de compartilhamento de Lancha Focker 215 Cabinada 150 HP. Valor da embarcação: R$ 168.000. Sistema inteligente de reservas online. Manutenção e seguro inclusos. Mensalidade: R$ 900,00.",
  priceUtef: 24000,
  imageUrl:
    "https://exclusiveclubitz.com/wp-content/uploads/2024/01/lancha-focker-215.jpg",
  isActive: true,
});

// 4. Exclusive Clubitz - Jetski Seadoo
await db.insert(products).values({
  category: "nautical",
  title: "Jetski Seadoo GTI 130 HP - Compartilhamento Anual",
  description:
    "Cota de compartilhamento de Jetski Seadoo GTI 130 HP. Valor do jetski: R$ 75.000. Diversão garantida com até 8 saídas mensais. Manutenção e seguro inclusos. Mensalidade: R$ 650,00.",
  priceUtef: 12000,
  imageUrl:
    "https://exclusiveclubitz.com/wp-content/uploads/2024/01/jetski-seadoo.jpg",
  isActive: true,
});

// 5. Exclusive Clubitz - Piper Seneca IV
await db.insert(products).values({
  category: "nautical",
  title: "PIPER SENECA IV - Compartilhamento de Aeronave",
  description:
    "Cota de compartilhamento de aeronave PIPER SENECA IV super luxuosa e pronta para voar. Valor da aeronave: USD 500.000 (R$ 2.500.000). Experiência exclusiva de aviação. Custo mensal: R$ 14.000,00.",
  priceUtef: 480000,
  imageUrl:
    "https://exclusiveclubitz.com/wp-content/uploads/2024/01/piper-seneca.jpg",
  isActive: true,
});

console.log("✅ Produtos atualizados com sucesso!");
console.log("\n📊 Total de produtos: 5");
console.log("  - Construção Civil: 1");
console.log("  - Financeira: 1");
console.log("  - Náutico: 3");

process.exit(0);
