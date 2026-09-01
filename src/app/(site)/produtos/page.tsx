/* eslint-disable @next/next/no-img-element -- URLs de produtos são cadastradas dinamicamente pelo administrador e não têm host previsível. */
import { ProductConvertButton } from "@/components/ecossistema/product-convert-button";
import { getProducts } from "@/lib/legacy/repository";

export const dynamic = "force-dynamic";

const category: Record<string, string> = {
  real_estate: "Imobiliário",
  financial: "Financeiro",
  nautical: "Náutico",
};

export default async function ProdutosPage() {
  const products = await getProducts();
  return (
    <div className="bg-gray-50 py-14 min-h-[65vh]">
      <div className="max-w-7xl mx-auto px-4">
        <h1 className="text-4xl md:text-5xl font-black text-[var(--brand-dark)]">Produtos do ecossistema</h1>
        <p className="text-gray-500 mt-4 mb-10 max-w-2xl">Use seu saldo UTEF para solicitar a conversão em produtos e benefícios disponíveis.</p>
        {products.length === 0 ? (
          <div className="bg-white p-10 text-center text-gray-500">Nenhum produto disponível no momento.</div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
            {products.map((product) => (
              <article key={product.id} className="bg-white border border-gray-100 shadow-sm overflow-hidden">
                {product.imageUrl && <img src={product.imageUrl} alt="" className="w-full h-48 object-cover" />}
                <div className="p-6">
                  <span className="text-xs uppercase tracking-widest font-bold text-[var(--brand-yellow-dark)]">{category[product.category]}</span>
                  <h2 className="font-black text-2xl text-[var(--brand-dark)] mt-2">{product.title}</h2>
                  <p className="text-gray-500 my-4 min-h-12">{product.description}</p>
                  <p className="text-2xl font-black text-[var(--brand-dark)] mb-5">{product.priceUtef.toLocaleString("pt-BR")} UTEF</p>
                  <ProductConvertButton productId={product.id} />
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
