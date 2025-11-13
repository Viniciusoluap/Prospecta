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
