import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { read, write, utils } from "xlsx";
import { strToU8, unzipSync, zipSync } from "fflate";
import { lerPci } from "./caixa/pci";
import { ACEITE_ARQUIVO_PCI, formatoPciPeloNome, MIME_PCI, validarPartePci, validarMontagemPci } from "../shared/pci-upload";

const original = new Uint8Array(readFileSync(new URL("./caixa/__fixtures__/pci-modelo-anonimo.xls", import.meta.url)));
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const parte = { uploadId: "12345678-1234-1234-1234-123456789012", chunkIndex: 0, totalChunks: 1, chunk: "AQID" };

describe("PCI da obra em formatos Excel", () => {
  it.each(["xls", "xlsx", "xlsm", "xlsb"] as const)("seletor, validação e montagem permitem .%s, inclusive com maiúsculas", formato => {
    const nome = `PCI EMILY .${formato.toUpperCase()}`;
    expect(formatoPciPeloNome(nome)).toBe(formato);
    expect(ACEITE_ARQUIVO_PCI.split(",")).toContain(`.${formato}`);
    expect(ACEITE_ARQUIVO_PCI.split(",")).toContain(MIME_PCI[formato]);
    expect(validarPartePci({ ...parte, nome }).nome).toBe(nome);
    expect(validarMontagemPci([{ chunk_index: 0, total_chunks: 1, file_name: nome, b64: parte.chunk }])).toBe(nome);
  });

  it.each(["xlsx", "xlsm"] as const)("lê .%s real com incidências, identificação, contrato e datas, sem alterar o arquivo", formato => {
    const pasta = read(original, { type: "array", cellDates: false });
    const bytes = new Uint8Array(write(pasta, { type: "array", bookType: formato, compression: true }));
    const antes = hash(bytes);
    const dados = lerPci(bytes);
    const base = lerPci(original);
    expect(dados.formato).toBe(formato);
    expect({ ...dados, formato: "xls" }).toEqual(base);
    expect(dados.incidencias.reduce((s, n) => s + n, 0)).toBeCloseTo(100, 8);
    expect(hash(bytes)).toBe(antes);
  });

  it("distingue um pacote .xlsb de um .xlsx", () => {
    const pasta = read(original, { type: "array" });
    const bytes = new Uint8Array(write(pasta, { type: "array", bookType: "xlsb", compression: true }));
    const dados = lerPci(bytes);
    expect(dados.formato).toBe("xlsb");
    expect(dados.incidencias).toEqual(lerPci(original).incidencias);
    expect(dados.identificacao.proponente).toBe("PROPONENTE DE TESTE");
  });

  it("lê cache de fórmulas e conserva o VBA como bytes, sem executá-lo", () => {
    const pasta = read(original, { type: "array" });
    const arquivos = unzipSync(new Uint8Array(write(pasta, { type: "array", bookType: "xlsm" })));
    arquivos["xl/vbaProject.bin"] = strToU8("MACRO DE TESTE INERTE");
    const bytes = zipSync(arquivos);
    const antes = hash(bytes);
    const dados = lerPci(bytes);
    expect(dados.formato).toBe("xlsm");
    expect(dados.incidencias[0]).toBe(lerPci(original).incidencias[0]);
    expect(hash(bytes)).toBe(antes);
    expect(unzipSync(bytes)["xl/vbaProject.bin"]).toEqual(arquivos["xl/vbaProject.bin"]);
  });

  it.each(["PCI.pdf", "PCI.xlsx.exe", "PCI.xlsm.zip", "PCI", "PCI.csv"])("recusa extensão inválida: %s", nome => {
    expect(formatoPciPeloNome(nome)).toBeNull();
    expect(() => validarPartePci({ ...parte, nome })).toThrow(/\.xlsx/);
  });

  it("não aceita ZIP genérico nem Excel sem a proposta da CAIXA", () => {
    expect(() => lerPci(zipSync({ "arquivo.txt": strToU8("texto") }))).toThrow();
    const pasta = utils.book_new();
    utils.book_append_sheet(pasta, utils.aoa_to_sheet([["Não é PCI"]]), "Planilha1");
    expect(() => lerPci(new Uint8Array(write(pasta, { type: "array", bookType: "xlsx" })))).toThrow(/Proposta_Constr_Individual/);
  });
});
