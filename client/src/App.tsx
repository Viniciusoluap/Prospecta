import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AdminRoute } from "./components/AdminRoute";
import Home from "./pages/Home";
import Sorteios from "./pages/Sorteios";
import ComprarBilhete from "./pages/ComprarBilhete";
import Produtos from "./pages/Produtos";
import MeusBilhetes from "./pages/MeusBilhetes";
import MeuSaldo from "./pages/MeuSaldo";
import Admin from "./pages/Admin";
import ConverterProduto from "./pages/ConverterProduto";
import ComoFunciona from "./pages/ComoFunciona";
import MinhasConversoes from "./pages/MinhasConversoes";
import ComprarUtef from "./pages/ComprarUtef";
import ProjetosOrcamentos from "./pages/ProjetosOrcamentos";
import Obras from "./pages/Obras";
import NovaObra from "./pages/NovaObra";
import ObraDetalhes from "./pages/ObraDetalhes";
import AdminObras from "./pages/AdminObras";
import AdminEditarObra from "./pages/AdminEditarObra";
import AdminOrcamentos from "./pages/AdminOrcamentos";
import Regulamento from "./pages/Regulamento";
import TermosDeUso from "./pages/TermosDeUso";
import PoliticaDePrivacidade from "./pages/PoliticaDePrivacidade";
import FAQ from "./pages/FAQ";
import AdminDashboard from "./pages/AdminDashboard";
import AdminEmails from "./pages/AdminEmails";
import Notificacoes from "./pages/Notificacoes";
import ConfiguracoesPagamento from "./pages/admin/ConfiguracoesPagamento";
import AdminCRM from "./pages/admin/AdminCRM";
import AdminLeadDetail from "./pages/admin/AdminLeadDetail";
import AdminFinanceiro from "./pages/admin/AdminFinanceiro";
import AdminTarefas from "./pages/admin/AdminTarefas";
import AdminCorretores from "./pages/admin/AdminCorretores";
import AdminRegularizacoes from "./pages/admin/AdminRegularizacoes";
import AdminWhatsApp from "./pages/admin/AdminWhatsApp";
import AdminBpo from "./pages/admin/AdminBpo";
import AdminObraMedicoes from "./pages/admin/AdminObraMedicoes";
import AdminAvaliacoes from "./pages/admin/AdminAvaliacoes";
import AdminAvaliacaoDetail from "./pages/admin/AdminAvaliacaoDetail";
import Imoveis from "./pages/Imoveis";
import ImovelDetalhes from "./pages/ImovelDetalhes";
import AdminImoveis from "./pages/admin/AdminImoveis";
import AdminImovelForm from "./pages/admin/AdminImovelForm";
import AdminIncorporacao from "./pages/admin/AdminIncorporacao";
import AdminIncorporacaoDetail from "./pages/admin/AdminIncorporacaoDetail";
import AdminFinanciamentos from "./pages/admin/AdminFinanciamentos";
import AdminJuridico from "./pages/admin/AdminJuridico";
import AdminConfiguracoes from "./pages/admin/AdminConfiguracoes";
import AdminAcesso from "./pages/admin/AdminAcesso";
import Servicos from "./pages/Servicos";
import Sobre from "./pages/Sobre";
import Contato from "./pages/Contato";
import Mercado from "./pages/Mercado";
import Cursos from "./pages/Cursos";
import Instituto from "./pages/Instituto";
import Perfil from "./pages/Perfil";
import SimuladorFinanciamento from "./pages/SimuladorFinanciamento";
import WhatsAppFloat from "./components/WhatsAppFloat";
import Login from "./pages/Login";
import Portal from "./pages/Portal";
import { PortalRoute } from "./components/PortalRoute";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/portal/:rest*"><PortalRoute><Portal /></PortalRoute></Route>
      <Route path="/portal"><PortalRoute><Portal /></PortalRoute></Route>
      <Route path={"/"} component={Home} />
      <Route path="/sorteios" component={Sorteios} />
      <Route path="/comprar-bilhete/:id" component={ComprarBilhete} />
      <Route path="/produtos" component={Produtos} />
      <Route path="/imoveis" component={Imoveis} />
      <Route path="/imoveis/:slug" component={ImovelDetalhes} />
      <Route path="/servicos" component={Servicos} />
      <Route path="/sobre" component={Sobre} />
      <Route path="/contato" component={Contato} />
      <Route path="/mercado" component={Mercado} />
      <Route path="/cursos" component={Cursos} />
      <Route path="/instituto" component={Instituto} />
      <Route path="/meus-bilhetes">
        <ProtectedRoute><MeusBilhetes /></ProtectedRoute>
      </Route>
      <Route path="/meu-saldo">
        <ProtectedRoute><MeuSaldo /></ProtectedRoute>
      </Route>
      <Route path="/perfil">
        <ProtectedRoute><Perfil /></ProtectedRoute>
      </Route>
      <Route path="/admin">
        <AdminRoute><Admin /></AdminRoute>
      </Route>
      <Route path="/admin/acesso">
        <AdminRoute allowStaffHome><AdminAcesso /></AdminRoute>
      </Route>
      <Route path="/converter-produto/:id">
        <ProtectedRoute><ConverterProduto /></ProtectedRoute>
      </Route>
      <Route path="/como-funciona" component={ComoFunciona} />
      <Route path="/minhas-conversoes">
        <ProtectedRoute><MinhasConversoes /></ProtectedRoute>
      </Route>
      <Route path="/comprar-utef" component={ComprarUtef} />
      <Route path="/projetos-orcamentos" component={ProjetosOrcamentos} />
      <Route path="/obras">
        <ProtectedRoute><Obras /></ProtectedRoute>
      </Route>
      <Route path="/obras/nova">
        <ProtectedRoute><NovaObra /></ProtectedRoute>
      </Route>
      <Route path="/obras/:id">
        <ProtectedRoute><ObraDetalhes /></ProtectedRoute>
      </Route>
      <Route path="/admin/obras">
        <AdminRoute module="obras"><AdminObras /></AdminRoute>
      </Route>
      <Route path="/admin/obras/editar/:id">
        <AdminRoute module="obras"><AdminEditarObra /></AdminRoute>
      </Route>
      <Route path="/admin/obras/:id/medicoes">
        <AdminRoute module="obras"><AdminObraMedicoes /></AdminRoute>
      </Route>
      <Route path="/admin/orcamentos">
        <AdminRoute module="projetos"><AdminOrcamentos /></AdminRoute>
      </Route>
      <Route path="/admin/dashboard">
        <AdminRoute module="dashboard"><AdminDashboard /></AdminRoute>
      </Route>
      <Route path="/admin/emails">
        <AdminRoute module="dashboard"><AdminEmails /></AdminRoute>
      </Route>
      <Route path="/admin/configuracoes-pagamento">
        <AdminRoute><ConfiguracoesPagamento /></AdminRoute>
      </Route>
      <Route path="/admin/crm/:id">
        <AdminRoute module="crm"><AdminLeadDetail /></AdminRoute>
      </Route>
      <Route path="/admin/crm">
        <AdminRoute module="crm"><AdminCRM /></AdminRoute>
      </Route>
      <Route path="/admin/contabilidade">
        <AdminRoute module="contabilidade"><AdminFinanceiro /></AdminRoute>
      </Route>
      {/* Compatibilidade temporária para favoritos antigos; não aparece mais na interface. */}
      <Route path="/admin/financeiro">
        <AdminRoute module="contabilidade"><AdminFinanceiro /></AdminRoute>
      </Route>
      <Route path="/admin/tarefas">
        <AdminRoute module="dashboard"><AdminTarefas /></AdminRoute>
      </Route>
      <Route path="/admin/corretores">
        <AdminRoute module="corretores"><AdminCorretores /></AdminRoute>
      </Route>
      <Route path="/admin/whatsapp">
        <AdminRoute module="whatsapp"><AdminWhatsApp /></AdminRoute>
      </Route>
      <Route path="/admin/bpo">
        <AdminRoute module="bpo"><AdminBpo /></AdminRoute>
      </Route>
      <Route path="/admin/regularizacoes">
        <AdminRoute module="regularizacao"><AdminRegularizacoes /></AdminRoute>
      </Route>
      <Route path="/admin/avaliacoes/:id">
        <AdminRoute module="avaliacoes"><AdminAvaliacaoDetail /></AdminRoute>
      </Route>
      <Route path="/admin/avaliacoes">
        <AdminRoute module="avaliacoes"><AdminAvaliacoes /></AdminRoute>
      </Route>
      <Route path="/admin/imoveis/novo">
        <AdminRoute module="imoveis"><AdminImovelForm /></AdminRoute>
      </Route>
      <Route path="/admin/imoveis/:id/editar">
        <AdminRoute module="imoveis"><AdminImovelForm /></AdminRoute>
      </Route>
      <Route path="/admin/imoveis">
        <AdminRoute module="imoveis"><AdminImoveis /></AdminRoute>
      </Route>
      <Route path="/admin/incorporacao/:id">
        <AdminRoute module="projetos"><AdminIncorporacaoDetail /></AdminRoute>
      </Route>
      <Route path="/admin/incorporacao">
        <AdminRoute module="projetos"><AdminIncorporacao /></AdminRoute>
      </Route>
      <Route path="/admin/financiamentos">
        <AdminRoute module="financiamentos"><AdminFinanciamentos /></AdminRoute>
      </Route>
      <Route path="/admin/juridico">
        <AdminRoute module="juridico"><AdminJuridico /></AdminRoute>
      </Route>
      <Route path="/admin/configuracoes">
        <AdminRoute><AdminConfiguracoes /></AdminRoute>
      </Route>
      <Route path="/notificacoes">
        <ProtectedRoute><Notificacoes /></ProtectedRoute>
      </Route>
      <Route path="/regulamento" component={Regulamento} />
      <Route path="/termos-de-uso" component={TermosDeUso} />
      <Route path="/politica-de-privacidade" component={PoliticaDePrivacidade} />
      <Route path="/faq" component={FAQ} />
      <Route path="/simulador" component={SimuladorFinanciamento} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
          <WhatsAppFloat />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
