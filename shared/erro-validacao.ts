// 10 implementações, item 07 — nunca mostrar JSON técnico de validação ao usuário.
// Converte as falhas de validação (zod) em uma frase com o nome do campo em português.

interface Falha {
  path: (string | number)[];
  code: string;
  message?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  type?: string;
  origin?: string;
}

const ROTULOS: Record<string, string> = {
  types: "Tipos de projeto", name: "Nome", engineer: "Engenheiro responsável", engineerUserId: "Engenheiro responsável",
  clientName: "Cliente", clientPhone: "Telefone do cliente", value: "Valor", paidValue: "Valor pago",
  deadline: "Prazo de entrega", status: "Situação", email: "E-mail", phone: "Telefone", password: "Senha",
  role: "Perfil", title: "Título", description: "Descrição", amount: "Valor", percent: "Percentual",
  dueDate: "Vencimento", address: "Endereço", responsible: "Responsável", type: "Tipo", cpf: "CPF",
};

function rotulo(path: (string | number)[]): string {
  const chave = [...path].reverse().find((p): p is string => typeof p === "string");
  return chave ? ROTULOS[chave] ?? chave : "formulário";
}

export function mensagemValidacao(falhas: Falha[]): string {
  const f = falhas[0];
  if (!f) return "Dados inválidos. Revise o formulário.";
  const campo = rotulo(f.path);
  const tipo = f.type ?? f.origin;
  switch (f.code) {
    case "too_small":
      if (tipo === "array") return `Selecione ao menos ${Number(f.minimum ?? 1) === 1 ? "uma opção" : `${f.minimum} opções`} em "${campo}".`;
      if (tipo === "string") return Number(f.minimum ?? 1) <= 1 ? `Preencha o campo "${campo}".` : `"${campo}" precisa ter ao menos ${f.minimum} caracteres.`;
      return `"${campo}" está abaixo do mínimo permitido.`;
    case "too_big":
      return tipo === "string" ? `"${campo}" passou do tamanho máximo (${f.maximum} caracteres).` : `"${campo}" está acima do máximo permitido.`;
    case "invalid_type":
      return `Preencha corretamente o campo "${campo}".`;
    case "invalid_enum_value":
    case "invalid_value":
      return `Escolha uma opção válida em "${campo}".`;
    case "invalid_string":
    case "invalid_format":
      return `O formato de "${campo}" é inválido.`;
    default:
      return f.message && !f.message.startsWith("[") && !/^(Invalid|Expected|Required)/.test(f.message)
        ? f.message
        : `Verifique o campo "${campo}".`;
  }
}
