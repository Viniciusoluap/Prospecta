// Maquete 3D (EPIC-022) — e-mails automáticos ao cliente: pedido aprovado (com o valor e o caminho para pagar) e
// maquete pronta (com o link). O destinatário é quem pediu no portal; se o pedido foi criado pela equipe, o
// e-mail do cadastro (lead) do projeto. Falha no envio nunca impede a aprovação nem a publicação: o resultado
// volta para a tela e o admin pode reenviar.
import { eq } from "drizzle-orm";
import { leads, operationalProjects, users } from "../../drizzle/schema.js";
import type { Maquete3d } from "../../drizzle/schema-maquete-3d.js";
import { IDENTIDADE_EMAIL, rodapeEmail } from "../../shared/email-identidade.js";
import { db, dependencias } from "./base.js";

export const SITE = "https://prospectaconstrucoes.com";
export type ResultadoAviso = { enviado: boolean; para: string | null; motivo?: string };

const escapar = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const valido = (e: string | null | undefined): e is string => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function destinatario(m: Maquete3d): Promise<{ email: string; nome: string } | null> {
  if (m.solicitadoPor) {
    const [u] = await db().select({ email: users.email, nome: users.name, papel: users.role }).from(users).where(eq(users.id, m.solicitadoPor)).limit(1);
    if (u?.papel === "cliente" && valido(u.email)) return { email: u.email, nome: u.nome ?? "Cliente" };
  }
  if (!m.projectId) return null;
  const [p] = await db().select({ leadId: operationalProjects.leadId, nome: operationalProjects.clientName }).from(operationalProjects).where(eq(operationalProjects.id, m.projectId)).limit(1);
  if (!p?.leadId) return null;
  const [l] = await db().select({ email: leads.email, nome: leads.name }).from(leads).where(eq(leads.id, p.leadId)).limit(1);
  return valido(l?.email) ? { email: l.email, nome: l.nome ?? p.nome } : null;
}

function corpo(titulo: string, nome: string, paragrafos: string[], botao: { texto: string; url: string }): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;margin:0">
  <div style="max-width:600px;margin:0 auto;padding:20px">
    <div style="background:linear-gradient(135deg,#1A2332 0%,#C9A961 100%);color:#fff;padding:30px;text-align:center;border-radius:10px 10px 0 0"><h1 style="margin:0;font-size:24px">${escapar(titulo)}</h1></div>
    <div style="background:#f9f9f9;padding:30px;border-radius:0 0 10px 10px">
      <p>Olá <strong>${escapar(nome)}</strong>,</p>
      ${paragrafos.map(t => `<p>${t}</p>`).join("\n      ")}
      <p style="text-align:center;margin:28px 0"><a href="${botao.url}" style="display:inline-block;background:#C9A961;color:#1A2332;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold">${escapar(botao.texto)}</a></p>
      <p style="font-size:13px;color:#666">Se o botão não abrir, copie este endereço no navegador:<br>${botao.url}</p>
    </div>
    <p style="text-align:center;margin-top:20px;color:#666;font-size:13px">${rodapeEmail()}</p>
  </div>
</body></html>`;
}

async function enviar(m: Maquete3d, motivo: "aprovado" | "pronta", assunto: string, html: (nome: string) => string): Promise<ResultadoAviso> {
  const d = await destinatario(m);
  if (!d) return { enviado: false, para: null, motivo: "O cliente não tem e-mail no cadastro." };
  try {
    const ok = await dependencias().carteiro({ para: d.email, nome: d.nome, assunto, html: html(d.nome), maqueteId: m.id, motivo });
    return ok ? { enviado: true, para: d.email } : { enviado: false, para: d.email, motivo: "O servidor de e-mail não aceitou a mensagem (confira o SMTP em Configurações)." };
  } catch { return { enviado: false, para: d.email, motivo: "Falha ao enviar o e-mail." }; }
}

/** Maquete publicada: manda o link para o cliente andar pela casa. */
export const avisarMaquetePronta = (m: Maquete3d) => enviar(m, "pronta", `Sua maquete 3D está pronta - ${IDENTIDADE_EMAIL}`, nome => corpo(
  "Sua maquete 3D está pronta", nome,
  [`A maquete 3D de <strong>${escapar(m.titulo.replace(/^Maquete 3D — /, ""))}</strong> ficou pronta.`,
    "Abra no computador ou no celular para ver a casa por fora, andar por dentro dos cômodos, trocar o estilo da decoração e ver a iluminação de manhã, no pôr do sol e à noite."],
  { texto: "Abrir a minha maquete 3D", url: `${SITE}/maquete/${m.token}` }));

/** Pedido aprovado pelo administrador: informa o valor e leva ao portal para pagar. */
export const avisarPedidoAprovado = (m: Maquete3d) => enviar(m, "aprovado", `Seu pedido de maquete 3D foi aprovado - ${IDENTIDADE_EMAIL}`, nome => corpo(
  "Pedido de maquete 3D aprovado", nome,
  [`O seu pedido de maquete 3D de <strong>${escapar(m.titulo.replace(/^Maquete 3D — /, ""))}</strong> foi aprovado.`,
    `Valor: <strong>${Number(m.preco).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>. O pagamento é feito no portal do cliente, por PIX, boleto ou cartão. Assim que ele for confirmado, a maquete entra em produção.`],
  { texto: "Pagar no portal do cliente", url: `${SITE}/portal/maquete-3d` }));
