import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calculator, Home, DollarSign, Calendar, Percent, TrendingDown, Gift, ArrowLeft, Info, Building2, Wallet, Clock, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";
import { APP_LOGO } from "@/const";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Faixas de renda MCMV com subsídios
const FAIXAS_MCMV = [
  { nome: "Faixa 1", rendaMin: 0, rendaMax: 2640, subsidioMax: 55000, taxaJuros: 4.0 },
  { nome: "Faixa 2", rendaMin: 2640.01, rendaMax: 4400, subsidioMax: 29000, taxaJuros: 5.0 },
  { nome: "Faixa 3", rendaMin: 4400.01, rendaMax: 8000, subsidioMax: 14000, taxaJuros: 7.66 },
  { nome: "Classe Média", rendaMin: 8000.01, rendaMax: 12000, subsidioMax: 0, taxaJuros: 10.0 },
];

// Função para formatar valores em Real
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
};

// Função para formatar número com separadores
const formatNumber = (value: number) => {
  return new Intl.NumberFormat('pt-BR').format(value);
};

export default function SimuladorFinanciamento() {
  // Estados do formulário
  const [valorImovel, setValorImovel] = useState(200000);
  const [rendaFamiliar, setRendaFamiliar] = useState(4000);
  const [valorEntrada, setValorEntrada] = useState(40000);
  const [prazoMeses, setPrazoMeses] = useState(420); // 35 anos
  const [usarFGTS, setUsarFGTS] = useState(false);
  const [valorFGTS, setValorFGTS] = useState(0);
  const [tipoImovel, setTipoImovel] = useState("novo");

  // Calcular a faixa de renda
  const faixaAtual = useMemo(() => {
    return FAIXAS_MCMV.find(f => rendaFamiliar >= f.rendaMin && rendaFamiliar <= f.rendaMax) || FAIXAS_MCMV[3];
  }, [rendaFamiliar]);

  // Calcular subsídio estimado (proporcional à renda dentro da faixa)
  const subsidioEstimado = useMemo(() => {
    if (faixaAtual.subsidioMax === 0) return 0;
    
    // Quanto menor a renda dentro da faixa, maior o subsídio
    const proporcao = 1 - ((rendaFamiliar - faixaAtual.rendaMin) / (faixaAtual.rendaMax - faixaAtual.rendaMin));
    return Math.round(faixaAtual.subsidioMax * proporcao * 0.7); // 70% do máximo como estimativa conservadora
  }, [rendaFamiliar, faixaAtual]);

  // Calcular valor financiado
  const valorFinanciado = useMemo(() => {
    const entradaTotal = valorEntrada + (usarFGTS ? valorFGTS : 0) + subsidioEstimado;
    return Math.max(0, valorImovel - entradaTotal);
  }, [valorImovel, valorEntrada, usarFGTS, valorFGTS, subsidioEstimado]);

  // Calcular parcela (Sistema SAC - primeira parcela)
  const parcelaSAC = useMemo(() => {
    if (valorFinanciado <= 0 || prazoMeses <= 0) return { primeira: 0, ultima: 0, media: 0 };
    
    const taxaMensal = faixaAtual.taxaJuros / 100 / 12;
    const amortizacao = valorFinanciado / prazoMeses;
    
    // Primeira parcela (maior)
    const primeiraParcela = amortizacao + (valorFinanciado * taxaMensal);
    
    // Última parcela (menor)
    const ultimaParcela = amortizacao + (amortizacao * taxaMensal);
    
    // Parcela média
    const parcelaMedia = (primeiraParcela + ultimaParcela) / 2;
    
    return {
      primeira: primeiraParcela,
      ultima: ultimaParcela,
      media: parcelaMedia
    };
  }, [valorFinanciado, prazoMeses, faixaAtual.taxaJuros]);

  // Verificar se a parcela cabe na renda (máximo 30%)
  const comprometimentoRenda = useMemo(() => {
    return (parcelaSAC.primeira / rendaFamiliar) * 100;
  }, [parcelaSAC.primeira, rendaFamiliar]);

  // Entrada mínima necessária (20%)
  const entradaMinima = valorImovel * 0.20;
  const entradaAtual = valorEntrada + (usarFGTS ? valorFGTS : 0) + subsidioEstimado;
  const entradaSuficiente = entradaAtual >= entradaMinima;

  return (
    <div className="min-h-screen bg-gradient-to-b from-secondary to-secondary/95">
      {/* Header */}
      <header className="bg-secondary/80 backdrop-blur-sm border-b border-primary/20 sticky top-0 z-50">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <ArrowLeft className="h-5 w-5 text-primary" />
              <img src={APP_LOGO} alt="Prospecta" className="h-10" />
              <span className="text-primary font-semibold hidden sm:inline">Voltar ao Início</span>
            </Link>
            <div className="flex items-center gap-2 text-primary">
              <Calculator className="h-6 w-6" />
              <span className="font-bold text-lg hidden sm:inline">Simulador de Financiamento</span>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8">
        {/* Título */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-primary mb-2">
            Simule seu Financiamento
          </h1>
          <p className="text-white/70 max-w-2xl mx-auto">
            Descubra o valor das parcelas e os benefícios do Minha Casa Minha Vida. 
            Simulação baseada nas condições da Caixa Econômica Federal.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Formulário de Simulação */}
          <div className="lg:col-span-2 space-y-6">
            {/* Card: Dados do Imóvel */}
            <Card className="bg-white/5 border-primary/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Home className="h-5 w-5" />
                  Dados do Imóvel
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Valor do Imóvel */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <Label className="text-white">Valor do Imóvel</Label>
                    <span className="text-primary font-bold text-lg">{formatCurrency(valorImovel)}</span>
                  </div>
                  <Slider
                    value={[valorImovel]}
                    onValueChange={(v) => setValorImovel(v[0])}
                    min={100000}
                    max={500000}
                    step={5000}
                    className="py-4"
                  />
                  <div className="flex justify-between text-xs text-white/50">
                    <span>R$ 100.000</span>
                    <span>R$ 500.000</span>
                  </div>
                </div>

                {/* Tipo de Imóvel */}
                <div className="space-y-2">
                  <Label className="text-white">Tipo de Imóvel</Label>
                  <Select value={tipoImovel} onValueChange={setTipoImovel}>
                    <SelectTrigger className="bg-white/10 border-primary/30 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="novo">Imóvel Novo</SelectItem>
                      <SelectItem value="usado">Imóvel Usado</SelectItem>
                      <SelectItem value="construcao">Construção</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Card: Dados Financeiros */}
            <Card className="bg-white/5 border-primary/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Wallet className="h-5 w-5" />
                  Dados Financeiros
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Renda Familiar */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Label className="text-white">Renda Familiar Bruta</Label>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-4 w-4 text-white/50" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Soma da renda de todos os membros da família</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <span className="text-primary font-bold text-lg">{formatCurrency(rendaFamiliar)}</span>
                  </div>
                  <Slider
                    value={[rendaFamiliar]}
                    onValueChange={(v) => setRendaFamiliar(v[0])}
                    min={1500}
                    max={12000}
                    step={100}
                    className="py-4"
                  />
                  <div className="flex justify-between text-xs text-white/50">
                    <span>R$ 1.500</span>
                    <span>R$ 12.000</span>
                  </div>
                  {/* Faixa MCMV */}
                  <div className="bg-primary/20 rounded-lg p-3 flex items-center justify-between">
                    <span className="text-white/80 text-sm">Sua faixa:</span>
                    <span className="text-primary font-bold">{faixaAtual.nome}</span>
                  </div>
                </div>

                {/* Valor da Entrada */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <Label className="text-white">Valor da Entrada</Label>
                    <span className="text-primary font-bold text-lg">{formatCurrency(valorEntrada)}</span>
                  </div>
                  <Slider
                    value={[valorEntrada]}
                    onValueChange={(v) => setValorEntrada(v[0])}
                    min={0}
                    max={valorImovel * 0.5}
                    step={1000}
                    className="py-4"
                  />
                  <div className="flex justify-between text-xs text-white/50">
                    <span>R$ 0</span>
                    <span>{formatCurrency(valorImovel * 0.5)}</span>
                  </div>
                </div>

                {/* FGTS */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="usarFGTS"
                      checked={usarFGTS}
                      onChange={(e) => setUsarFGTS(e.target.checked)}
                      className="w-5 h-5 rounded border-primary/30 bg-white/10 text-primary focus:ring-primary"
                    />
                    <Label htmlFor="usarFGTS" className="text-white cursor-pointer">
                      Usar FGTS como entrada
                    </Label>
                  </div>
                  {usarFGTS && (
                    <div className="pl-8 space-y-2">
                      <Label className="text-white/70 text-sm">Saldo do FGTS</Label>
                      <Input
                        type="number"
                        value={valorFGTS}
                        onChange={(e) => setValorFGTS(Number(e.target.value))}
                        className="bg-white/10 border-primary/30 text-white"
                        placeholder="Digite o valor do FGTS"
                      />
                    </div>
                  )}
                </div>

                {/* Prazo */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Label className="text-white">Prazo do Financiamento</Label>
                    </div>
                    <span className="text-primary font-bold text-lg">
                      {Math.floor(prazoMeses / 12)} anos ({prazoMeses} meses)
                    </span>
                  </div>
                  <Slider
                    value={[prazoMeses]}
                    onValueChange={(v) => setPrazoMeses(v[0])}
                    min={60}
                    max={420}
                    step={12}
                    className="py-4"
                  />
                  <div className="flex justify-between text-xs text-white/50">
                    <span>5 anos</span>
                    <span>35 anos</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Resultado da Simulação */}
          <div className="space-y-6">
            {/* Card: Resultado Principal */}
            <Card className="bg-gradient-to-br from-primary/20 to-primary/5 border-primary/50">
              <CardHeader>
                <CardTitle className="text-primary text-center">Resultado da Simulação</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Parcela */}
                <div className="text-center py-4 bg-white/10 rounded-lg">
                  <p className="text-white/70 text-sm mb-1">Primeira Parcela (SAC)</p>
                  <p className="text-3xl font-bold text-primary">
                    {formatCurrency(parcelaSAC.primeira)}
                  </p>
                  <p className="text-white/50 text-xs mt-1">
                    Última parcela: {formatCurrency(parcelaSAC.ultima)}
                  </p>
                </div>

                {/* Detalhes */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2 border-b border-white/10">
                    <span className="text-white/70 text-sm">Valor Financiado</span>
                    <span className="text-white font-medium">{formatCurrency(valorFinanciado)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-white/10">
                    <span className="text-white/70 text-sm">Taxa de Juros</span>
                    <span className="text-white font-medium">{faixaAtual.taxaJuros}% a.a.</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-white/10">
                    <span className="text-white/70 text-sm">Entrada Total</span>
                    <span className="text-white font-medium">{formatCurrency(entradaAtual)}</span>
                  </div>
                  {subsidioEstimado > 0 && (
                    <div className="flex justify-between items-center py-2 border-b border-white/10">
                      <span className="text-accent text-sm flex items-center gap-1">
                        <Gift className="h-4 w-4" /> Subsídio Estimado
                      </span>
                      <span className="text-accent font-bold">{formatCurrency(subsidioEstimado)}</span>
                    </div>
                  )}
                </div>

                {/* Alertas */}
                <div className="space-y-2 pt-2">
                  {/* Comprometimento de renda */}
                  <div className={`p-3 rounded-lg ${comprometimentoRenda <= 30 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                    <div className="flex items-center gap-2">
                      {comprometimentoRenda <= 30 ? (
                        <CheckCircle2 className="h-5 w-5 text-green-400" />
                      ) : (
                        <Info className="h-5 w-5 text-red-400" />
                      )}
                      <span className={`text-sm ${comprometimentoRenda <= 30 ? 'text-green-400' : 'text-red-400'}`}>
                        {comprometimentoRenda.toFixed(1)}% da renda comprometida
                      </span>
                    </div>
                    {comprometimentoRenda > 30 && (
                      <p className="text-xs text-red-300 mt-1 ml-7">
                        Recomendado: máximo 30% da renda
                      </p>
                    )}
                  </div>

                  {/* Entrada suficiente */}
                  <div className={`p-3 rounded-lg ${entradaSuficiente ? 'bg-green-500/20' : 'bg-yellow-500/20'}`}>
                    <div className="flex items-center gap-2">
                      {entradaSuficiente ? (
                        <CheckCircle2 className="h-5 w-5 text-green-400" />
                      ) : (
                        <Info className="h-5 w-5 text-yellow-400" />
                      )}
                      <span className={`text-sm ${entradaSuficiente ? 'text-green-400' : 'text-yellow-400'}`}>
                        {entradaSuficiente ? 'Entrada suficiente (≥20%)' : `Faltam ${formatCurrency(entradaMinima - entradaAtual)} para entrada mínima`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* CTA */}
                <div className="pt-4">
                  <Link href="/orcamentos">
                    <Button className="w-full bg-accent hover:bg-accent/90 text-secondary font-bold py-6">
                      Solicitar Orçamento Grátis
                    </Button>
                  </Link>
                  <p className="text-center text-white/50 text-xs mt-2">
                    Sem compromisso • Resposta em até 24h
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Card: Benefícios MCMV */}
            {subsidioEstimado > 0 && (
              <Card className="bg-accent/10 border-accent/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-accent text-lg flex items-center gap-2">
                    <Gift className="h-5 w-5" />
                    Benefícios MCMV
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-white/80 text-sm">
                    Na {faixaAtual.nome}, você pode ter:
                  </p>
                  <ul className="text-white/70 text-sm space-y-1">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-accent" />
                      Subsídio de até {formatCurrency(faixaAtual.subsidioMax)}
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-accent" />
                      Taxa de juros reduzida ({faixaAtual.taxaJuros}% a.a.)
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-accent" />
                      Prazo de até 35 anos para pagar
                    </li>
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Aviso Legal */}
            <p className="text-white/40 text-xs text-center">
              * Simulação ilustrativa. Os valores reais podem variar de acordo com a análise de crédito 
              e condições vigentes da Caixa Econômica Federal.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
