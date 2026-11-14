# Prompt mestre — planta baixa para tour 3D interativo (resumo fiel, 14/11/2026)

Enviado pelo dono em 14/11/2026. O texto original pede uma aplicação por planta; no EPIC-022 ele foi adaptado para
um motor dentro da Prospecta (ver `EPIC.md`, "Arquitetura"). Etapas pedidas e onde cada uma entra:

| Etapa do prompt | Conteúdo | Onde entra |
|---|---|---|
| 1. Leitura e interpretação | Cômodos, dimensões, áreas, paredes e espessuras, portas, janelas, circulação, escadas e desníveis, garagem, varanda, entrada principal, pé-direito. Preservar a geometria; não inventar; pedir confirmação do que faltar; separar medida confirmada de estimativa; conferir áreas e conexões; resumo técnico antes de construir. | Etapa 1 (motor de leitura + revisão) |
| 2. Construção 3D | Three.js/WebGL; piso, paredes, portas, janelas, lajes, forro, cobertura, revestimentos, vidros; escala em metros; colisão; visão externa (órbita) e interna (caminhada); ocultar telhado. | Etapa 2 |
| 3. Interiores e mobiliário | Mobília por função do cômodo; três estilos trocáveis com um clique (Moderno, Escandinavo, Luxo aconchegante); materiais realistas; respeitar portas, janelas e circulação. | Etapa 2 (mobília paramétrica gerada pelo motor) |
| 4. Iluminação dinâmica | Controle deslizante manhã / pôr do sol / noite, com transição suave, sombras e luzes internas à noite. | Etapa 2 |
| 5. Tour automático | Botão "INICIAR TOUR VIRTUAL"; percurso da entrada pelos cômodos com nome, área e característica comprovada; vista superior no fim; pausar/continuar/reiniciar; trilha instrumental gerada por código; botão de som. | Etapa 2 |
| 6. Apresentação comercial | Nome, logotipo, localização, área, quartos, banheiros, vagas, preço (se informado), botões Explorar / Iniciar tour / Falar com consultor (WhatsApp); seletor de plantas. Não inventar dados comerciais. | Etapa 2 (dados vêm do projeto/estudo) |
| 7. Interface | Menu, alternância de visão, telhado, estilos, horário, tour, som, tela cheia, voltar à entrada, ambiente atual, miniatura da planta. WASD + mouse no computador; toque e joystick no celular. | Etapa 2 |
| 8. Desempenho | Reuso de geometrias e materiais, InstancedMesh, qualidade gráfica ajustável, limite de resolução, tratamento de erros. | Etapa 2 |
| 9. Validação | Cômodos, dimensões, paredes, aberturas, circulação, colisão, tour, iluminação, estilos, celular. Não declarar teste que não foi executado. | Etapa 1 (validação do modelo) e etapa 2 (visualizador) |
| 10. Entrega | Aplicação funcional, link compartilhável, lista de recursos e limitações, estrutura reutilizável para outros empreendimentos. | Link `/maquete/<token>` (etapa 2) |

Diretrizes finais do prompt: fidelidade arquitetônica acima de efeito visual; experiência comercial; celular;
reutilização; não considerar pronto só porque o código foi gerado.
