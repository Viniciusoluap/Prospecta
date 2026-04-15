import { drizzle } from "drizzle-orm/mysql2";
import { draws, products } from "./drizzle/schema.js";

const db = drizzle(process.env.DATABASE_URL);

async function seed() {
  console.log("🌱 Iniciando seed do banco de dados...");

  try {
    // Criar sorteio ativo
    console.log("📋 Criando sorteio de exemplo...");
    const drawResult = await db.insert(draws).values({
      title: "Sorteio Efficaz 2025 - 200 Mil UTEFs",
      description:
        "Participe e concorra a 200.000 UTEFs para converter em imóveis, serviços financeiros ou embarcações do Grupo Efficaz!",
      prizeAmount: 200000,
      ticketPrice: 200, // R$ 2,00 em centavos
      targetAmount: 200000000, // R$ 2.000.000,00 em centavos (meta de arrecadação)
      currentAmount: 45000000, // R$ 450.000,00 já arrecadados (simulação)
      ticketsSold: 225000, // 225 mil bilhetes vendidos
      status: "active",
      drawDate: new Date("2025-12-31T20:00:00Z"),
    });
    console.log("✅ Sorteio criado com sucesso!");

    // Criar produtos de Construção Civil
    console.log("🏗️ Criando produtos de Construção Civil...");
    await db.insert(products).values([
      {
        category: "real_estate",
        title: "Casa Térrea 53m² - Projeto Polímeros",
        description:
          "Casa térrea completa de 53m² no Loteamento Morada do Bosque, Imperatriz-MA. Acabamento de primeira qualidade.",
        priceUtef: 180000,
        imageUrl:
          "https://placehold.co/600x400/2C5F2D/FFFFFF?text=Casa+Polimeros",
        details: JSON.stringify({
          description:
            "2 quartos, sala, cozinha, banheiro, área de serviço. Localização: Av. dos Marrecos, Q-O, Imperatriz-MA.",
          features: [
            "2 quartos",
            "Sala",
            "Cozinha americana",
            "Banheiro",
            "Área de serviço",
            "Garagem",
          ],
        }),
        status: "available",
      },
      {
        category: "real_estate",
        title: "Lote 200m² - Loteamento Vale Dourado",
        description:
          "Lote residencial de 200m² em Parauapebas-PA, infraestrutura completa e pronto para construir.",
        priceUtef: 50000,
        imageUrl:
          "https://placehold.co/600x400/2C5F2D/FFFFFF?text=Lote+Vale+Dourado",
        details: JSON.stringify({
          description:
            "Lote plano, com água, luz e asfalto. Localização privilegiada em Parauapebas-PA.",
          features: [
            "200m²",
            "Água",
            "Luz",
            "Asfalto",
            "Documentação regularizada",
          ],
        }),
        status: "available",
      },
    ]);
    console.log("✅ Produtos de Construção Civil criados!");

    // Criar produtos Financeiros
    console.log("💰 Criando produtos da Financeira...");
    await db.insert(products).values([
      {
        category: "financial",
        title: "Crédito Pessoal - Até R$ 50.000",
        description:
          "Crédito pessoal com taxas especiais para clientes Efficaz. Aprovação rápida e sem burocracia.",
        priceUtef: 5000,
        imageUrl:
          "https://placehold.co/600x400/FFD700/2C5F2D?text=Credito+Pessoal",
        details: JSON.stringify({
          description:
            "Use 5.000 UTEFs para descontar nas taxas de um crédito pessoal de até R$ 50.000.",
          features: [
            "Até R$ 50.000",
            "Taxas reduzidas",
            "Aprovação em 48h",
            "Sem consulta ao SPC/Serasa",
          ],
        }),
        status: "available",
      },
      {
        category: "financial",
        title: "Financiamento Veicular - Entrada Facilitada",
        description:
          "Financie seu veículo com entrada reduzida utilizando seus UTEFs.",
        priceUtef: 10000,
        imageUrl:
          "https://placehold.co/600x400/FFD700/2C5F2D?text=Financiamento+Veiculo",
        details: JSON.stringify({
          description:
            "Use 10.000 UTEFs como entrada para financiamento de veículo novo ou seminovo.",
          features: [
            "Entrada facilitada",
            "Taxas competitivas",
            "Até 60 meses",
            "Carros novos e seminovos",
          ],
        }),
        status: "available",
      },
    ]);
    console.log("✅ Produtos da Financeira criados!");

    // Criar produtos Náuticos
    console.log("⛵ Criando produtos Náuticos...");
    await db.insert(products).values([
      {
        category: "nautical",
        title: "Lancha Phantom 300 - Compartilhamento",
        description:
          "Compartilhamento de lancha Phantom 300 por 12 meses. Inclui manutenção e seguro.",
        priceUtef: 80000,
        imageUrl:
          "https://placehold.co/600x400/0066CC/FFFFFF?text=Lancha+Phantom",
        details: JSON.stringify({
          description:
            "Acesso exclusivo à lancha Phantom 300 por 12 meses, com até 4 saídas mensais.",
          features: [
            "12 meses de acesso",
            "4 saídas/mês",
            "Manutenção inclusa",
            "Seguro total",
            "Capacidade: 8 pessoas",
          ],
        }),
        status: "available",
      },
      {
        category: "nautical",
        title: "Jet Ski Sea-Doo - Compartilhamento Anual",
        description:
          "Compartilhamento de Jet Ski Sea-Doo por 12 meses. Diversão garantida!",
        priceUtef: 40000,
        imageUrl: "https://placehold.co/600x400/0066CC/FFFFFF?text=Jet+Ski",
        details: JSON.stringify({
          description:
            "Acesso ao Jet Ski Sea-Doo por 12 meses, com até 8 saídas mensais.",
          features: [
            "12 meses de acesso",
            "8 saídas/mês",
            "Manutenção inclusa",
            "Seguro total",
            "Capacidade: 2 pessoas",
          ],
        }),
        status: "available",
      },
    ]);
    console.log("✅ Produtos Náuticos criados!");

    console.log("\n🎉 Seed concluído com sucesso!");
    console.log("📊 Dados criados:");
    console.log("   - 1 sorteio ativo");
    console.log("   - 6 produtos (2 imóveis, 2 financeiros, 2 náuticos)");
  } catch (error) {
    console.error("❌ Erro ao executar seed:", error);
    throw error;
  }
}

seed()
  .then(() => {
    console.log("✅ Processo finalizado!");
    process.exit(0);
  })
  .catch(error => {
    console.error("❌ Falha no seed:", error);
    process.exit(1);
  });
