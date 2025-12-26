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
import Perfil from "./pages/Perfil";
import WhatsAppFloat from "./components/WhatsAppFloat";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path="/sorteios" component={Sorteios} />
      <Route path="/comprar-bilhete/:id" component={ComprarBilhete} />
      <Route path="/produtos" component={Produtos} />
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
        <AdminRoute><AdminObras /></AdminRoute>
      </Route>
      <Route path="/admin/obras/editar/:id">
        <AdminRoute><AdminEditarObra /></AdminRoute>
      </Route>
      <Route path="/admin/orcamentos">
        <AdminRoute><AdminOrcamentos /></AdminRoute>
      </Route>
      <Route path="/admin/dashboard">
        <AdminRoute><AdminDashboard /></AdminRoute>
      </Route>
      <Route path="/admin/emails">
        <AdminRoute><AdminEmails /></AdminRoute>
      </Route>
      <Route path="/admin/configuracoes-pagamento">
        <AdminRoute><ConfiguracoesPagamento /></AdminRoute>
      </Route>
      <Route path="/notificacoes">
        <ProtectedRoute><Notificacoes /></ProtectedRoute>
      </Route>
      <Route path="/regulamento" component={Regulamento} />
      <Route path="/termos-de-uso" component={TermosDeUso} />
      <Route path="/politica-de-privacidade" component={PoliticaDePrivacidade} />
      <Route path="/faq" component={FAQ} />
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
