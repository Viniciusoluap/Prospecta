import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
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

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path="/sorteios" component={Sorteios} />
      <Route path="/comprar-bilhete/:id" component={ComprarBilhete} />
      <Route path="/produtos" component={Produtos} />
      <Route path="/meus-bilhetes" component={MeusBilhetes} />
      <Route path="/meu-saldo" component={MeuSaldo} />
      <Route path="/admin" component={Admin} />
      <Route path="/converter-produto/:id" component={ConverterProduto} />
      <Route path="/como-funciona" component={ComoFunciona} />
      <Route path="/minhas-conversoes" component={MinhasConversoes} />
      <Route path="/comprar-utef" component={ComprarUtef} />
      <Route path="/projetos-orcamentos" component={ProjetosOrcamentos} />
      <Route path="/obras" component={Obras} />
      <Route path="/obras/nova" component={NovaObra} />
      <Route path="/obras/:id" component={ObraDetalhes} />
      <Route path="/admin/obras" component={AdminObras} />
      <Route path="/admin/obras/editar/:id" component={AdminEditarObra} />
      <Route path="/admin/orcamentos" component={AdminOrcamentos} />
      <Route path="/admin/dashboard" component={AdminDashboard} />
      <Route path="/admin/emails" component={AdminEmails} />
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
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
