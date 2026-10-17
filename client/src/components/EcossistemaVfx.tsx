import { Link } from "wouter";
import { Building2, Clock, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Seção "Ecossistema VFX Capital" — Home e página de Sorteios (pedido de 18/10, item 1). */
export function EcossistemaVfx() {
  return (
    <section className="py-20 bg-secondary text-white">
      <div className="container">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold mb-4 text-primary">
            Ecossistema VFX Capital
          </h2>
          <p className="text-xl text-white/80 max-w-3xl mx-auto">
            Além da construção, oferecemos um ecossistema completo de
            investimentos e benefícios
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <Card className="bg-white/10 border-primary/30 hover:border-primary transition-colors">
            <CardContent className="pt-6 text-center">
              <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-4">
                <DollarSign className="h-8 w-8 text-accent" />
              </div>
              <h3 className="text-xl font-bold mb-2 text-primary">Sorteios</h3>
              <p className="text-white/70 mb-4">
                Participe de sorteios e ganhe 200.000 UTEFs
              </p>
              <Button
                asChild
                variant="outline"
                className="border-primary text-white hover:bg-primary/20"
              >
                <Link href="/sorteios">Ver Sorteios</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-white/10 border-primary/30 hover:border-primary transition-colors">
            <CardContent className="pt-6 text-center">
              <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-4">
                <Building2 className="h-8 w-8 text-accent" />
              </div>
              <h3 className="text-xl font-bold mb-2 text-primary">Produtos</h3>
              <p className="text-white/70 mb-4">
                Converta UTEFs em casas, serviços e embarcações
              </p>
              <Button
                asChild
                variant="outline"
                className="border-primary text-white hover:bg-primary/20"
              >
                <Link href="/produtos">Ver Produtos</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-white/10 border-primary/30 hover:border-primary transition-colors">
            <CardContent className="pt-6 text-center">
              <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto mb-4">
                <Clock className="h-8 w-8 text-accent" />
              </div>
              <h3 className="text-xl font-bold mb-2 text-primary">
                Como Funciona
              </h3>
              <p className="text-white/70 mb-4">
                Entenda o sistema de UTEFs e conversões
              </p>
              <Button
                asChild
                variant="outline"
                className="border-primary text-white hover:bg-primary/20"
              >
                <Link href="/como-funciona">Saiba Mais</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
