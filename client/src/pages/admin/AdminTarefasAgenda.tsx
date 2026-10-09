import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, CalendarDays, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import AdminAgenda from "./AdminAgenda";
import AdminTarefas from "./AdminTarefas";
import { LinkedServiceQueue } from "./LinkedServiceQueue";

type View = "tarefas" | "agenda";

export default function AdminTarefasAgenda({
  initialView,
}: {
  initialView?: View;
}) {
  const queryView = new URLSearchParams(window.location.search).get(
    "aba"
  ) as View | null;
  const [view, setView] = useState<View>(
    queryView === "agenda" || queryView === "tarefas"
      ? queryView
      : initialView || "tarefas"
  );
  const tabClass = (item: View) =>
    `rounded-lg px-4 py-2 text-sm font-bold ${view === item ? "bg-[#C9A961] text-[#1A2332]" : "bg-[#2C3E50] text-gray-300"}`;
  return (
    <div className="min-h-screen bg-[#1A2332] text-white">
      <header className="border-b border-[#C9A961]/20 bg-[#0F1923] px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-4">
          <Link href="/admin">
            <Button variant="ghost" size="icon" className="text-gray-400">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[#C9A961]">
              Tarefas e Agenda
            </h1>
            <p className="text-sm text-gray-400">
              Demandas, SLA, visitas e compromissos em um só lugar
            </p>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <LinkedServiceQueue module="tarefas" title="Tarefas e Agenda" />
        <div className="flex gap-2">
          <button
            className={tabClass("tarefas")}
            onClick={() => setView("tarefas")}
          >
            <CheckSquare className="mr-1 inline h-4 w-4" /> Tarefas e SLA
          </button>
          <button
            className={tabClass("agenda")}
            onClick={() => setView("agenda")}
          >
            <CalendarDays className="mr-1 inline h-4 w-4" /> Agenda e calendário
          </button>
        </div>
        {view === "tarefas" ? (
          <AdminTarefas embedded />
        ) : (
          <AdminAgenda embedded />
        )}
      </div>
    </div>
  );
}
