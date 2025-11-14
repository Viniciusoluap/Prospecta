import os
import mysql.connector

# Conectar ao banco de dados
db = mysql.connector.connect(
    host=os.getenv("DB_HOST", "localhost"),
    user=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
    database=os.getenv("DB_NAME")
)

cursor = db.cursor()

print("🗑️  Removendo produtos antigos...")
cursor.execute("DELETE FROM products")

print("✅ Inserindo produtos corretos...")

products = [
    # 1. Prospecta Construções
    ("real_estate", "Casa Padrão 47m² - Prospecta Construções", 
     "Casa térrea completa de 47m² com financiamento facilitado pela Caixa Econômica Federal. Acabamento de primeira qualidade, projetos personalizados. 2 quartos, sala, cozinha, banheiro e área de serviço. Parcelas mais baratas que aluguel!",
     180000, "https://prospectaconstrucoes.com/wp-content/uploads/2024/01/planta-casa-150m2-1o-piso.jpg", 1),
    
    # 2. Efficaz Financeira
    ("financial", "Crédito UTEF 0,35% - Financiamento Habitacional",
     "Ao financiar seu imóvel com o Grupo Efficaz, você recebe 0,35% do valor financiado em tokens UTEF! Exemplo: Financiamento de R$ 180.000 = 630 UTEF de bônus. Use seus tokens para adquirir outros produtos do ecossistema.",
     0, "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=800", 1),
    
    # 3. Lancha Focker
    ("nautical", "Lancha Focker 215 Cabinada 150 HP - Compartilhamento",
     "Cota de compartilhamento de Lancha Focker 215 Cabinada 150 HP. Valor da embarcação: R$ 168.000. Sistema inteligente de reservas online. Manutenção e seguro inclusos. Mensalidade: R$ 900,00.",
     24000, "https://exclusiveclubitz.com/wp-content/uploads/2024/01/lancha-focker-215.jpg", 1),
    
    # 4. Jetski Seadoo
    ("nautical", "Jetski Seadoo GTI 130 HP - Compartilhamento Anual",
     "Cota de compartilhamento de Jetski Seadoo GTI 130 HP. Valor do jetski: R$ 75.000. Diversão garantida com até 8 saídas mensais. Manutenção e seguro inclusos. Mensalidade: R$ 650,00.",
     12000, "https://exclusiveclubitz.com/wp-content/uploads/2024/01/jetski-seadoo.jpg", 1),
    
    # 5. Piper Seneca IV
    ("nautical", "PIPER SENECA IV - Compartilhamento de Aeronave",
     "Cota de compartilhamento de aeronave PIPER SENECA IV super luxuosa e pronta para voar. Valor da aeronave: USD 500.000 (R$ 2.500.000). Experiência exclusiva de aviação. Custo mensal: R$ 14.000,00.",
     480000, "https://exclusiveclubitz.com/wp-content/uploads/2024/01/piper-seneca.jpg", 1),
]

for product in products:
    cursor.execute("""
        INSERT INTO products (category, title, description, priceUtef, imageUrl, isActive)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, product)

db.commit()

print("✅ Produtos atualizados com sucesso!")
print("\n📊 Total de produtos: 5")
print("  - Construção Civil: 1")
print("  - Financeira: 1")
print("  - Náutico: 3")

cursor.close()
db.close()
