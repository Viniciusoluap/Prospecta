# Plantas de teste do leitor geométrico (EPIC-023, S-D)

`terrea.pdf` (1 página, 8 × 12 m, sem escala escrita na página) e `sobrado.pdf` (2 páginas, 10 × 14 m, "ESC. 1:75")
são PDFs **vetoriais** desenhados no estilo de uma exportação de CAD: paredes em linha dupla, portas com o arco da
folha, janelas com as linhas do caixilho, vãos com ombreiras, nome e área interna de cada cômodo, degraus da escada.
Os `.json` são o gabarito (a casa padrão de `shared/maquete-3d/padrao.ts` que deu origem a cada desenho).

Não são projetos reais: servem para garantir que o leitor não regrida. A precisão em projetos reais de escritório
(camadas, hachuras, mobiliário, blocos) precisa ser medida com os arquivos do dono.
