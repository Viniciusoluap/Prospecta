import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies.js";
import { systemRouter } from "./_core/systemRouter.js";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc.js";
import { z } from "zod";
import { notifyOwner } from "./_core/notification.js";
import { stripe } from "./_core/stripe.js";
import { createAsaasPayment, getAsaasPixQrCode, createOrUpdateAsaasCustomer } from "./_core/asaas.js";
import { ENV } from "./_core/env.js";
import QRCode from "qrcode";
import * as db from "./db.js";
import { TRPCError } from "@trpc/server";
import { validateCPF, cleanCPF } from "../shared/cpf.js";
import { getChecklistGroups, getEstadoGeralOptions, CHECKLIST_MAX_FOTOS } from "../shared/avaliacao-checklist.js";
import { gerarSugestaoValor } from "./_core/avaliacao-ia.js";
import { scrapeUrl } from "./_core/imovel-scraper.js";
import { paymentSettingsRouter } from "./payment-settings-router.js";
import { regularizacaoRouter } from "./regularizacao-router.js";
import { portalRouter } from "./portal-router.js";
import { whatsappRouter } from "./whatsapp-router.js";
import { requireRole, STAFF_ROLES } from "./_core/rbac.js";
import { encryptSecret, decryptSecret } from "./_core/secret-vault.js";
import { authenticatePluggy, fetchPluggyTransactions, fetchPluggyAccountBalance } from "./_core/pluggy.js";
import { parseKmlTerreno } from "./_core/geo/kml.js";
import { fetchElevationGrid } from "./_core/geo/elevacao.js";
import { pesquisarMercado } from "./_core/incorporacao/mercado-ia.js";
import { financiamentoRouter } from "./financiamento-router.js";

// Helper para gerar número de bilhete único
function generateTicketNumber(): string {
  return `TKT${Date.now()}${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
}

// Helper para gerar código PIX (BR Code)
function generatePixBRCode(amount: number, pixKey: string, merchantName: string, merchantCity: string, txid: string): string {
  const amountStr = (amount / 100).toFixed(2);
  
  // Formato PIX BR Code simplificado
  const payload = [
    { id: '00', value: '01' }, // Payload Format Indicator
    { id: '26', value: `0014br.gov.bcb.pix01${pixKey.length.toString().padStart(2, '0')}${pixKey}` }, // Merchant Account Information
    { id: '52', value: '0000' }, // Merchant Category Code
    { id: '53', value: '986' }, // Transaction Currency (BRL)
    { id: '54', value: amountStr }, // Transaction Amount
    { id: '58', value: 'BR' }, // Country Code
    { id: '59', value: merchantName.substring(0, 25) }, // Merchant Name
    { id: '60', value: merchantCity.substring(0, 15) }, // Merchant City
    { id: '62', value: `05${txid.length.toString().padStart(2, '0')}${txid}` }, // Additional Data Field
  ];
  
  let brcode = '';
  for (const item of payload) {
    brcode += item.id + item.value.length.toString().padStart(2, '0') + item.value;
  }
  
  // CRC16 simplificado (para produção, usar biblioteca adequada)
  brcode += '6304';
  const crc = calculateCRC16(brcode);
  brcode += crc;
  
  return brcode;
}

// CRC16 CCITT-FALSE para PIX
function calculateCRC16(str: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

// Helper para gerar PIX completo
async function generatePixCode(amount: number, ticketNumber: string): Promise<{ pixCopyPaste: string; pixQrCode: string }> {
  // Código PIX fixo fornecido pelo usuário
  const pixCopyPaste = '00020101021126490014br.gov.bcb.pix0127contato@grupoefficaz.com.br5204000053039865802BR5925EFFICAZ PROMOCAO DE VENDA6009SAO PAULO622905251KA59P2H5DDDDBZ38HJZQA2GV63043C89';
  const pixQrCode = await QRCode.toDataURL(pixCopyPaste);
  
  return { pixCopyPaste, pixQrCode };
}

export const appRouter = router({
  system: systemRouter,
  paymentSettings: paymentSettingsRouter,
  regularizacao: regularizacaoRouter,
  portal: portalRouter,
  whatsapp: whatsappRouter,
  financiamentos: financiamentoRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // ========== USER (USUÁRIO) ==========
  user: router({
    updateProfile: protectedProcedure
      .input(z.object({
        name: z.string().optional(),
        email: z.string().email().optional(),
        cpf: z.string().max(14).optional(),
        phone: z.string().max(20).optional(),
        address: z.string().optional(),
        city: z.string().max(100).optional(),
        state: z.string().max(2).optional(),
        zipCode: z.string().max(10).optional(),
        avatarUrl: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Validar CPF se fornecido
        if (input.cpf && cleanCPF(input.cpf).length === 11) {
          const cpfValidation = validateCPF(input.cpf);
          if (!cpfValidation.valid) {
            throw new TRPCError({ 
              code: "BAD_REQUEST", 
              message: cpfValidation.message 
            });
          }
        }
        
        await db.updateUserProfile(ctx.user.id, input);
        return { success: true };
      }),
      
    // Upload de avatar
    uploadAvatar: protectedProcedure
      .input(z.object({
        imageBase64: z.string(),
        mimeType: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { storagePut } = await import("./storage.js");
        
        // Converter base64 para buffer
        const base64Data = input.imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        
        // Gerar nome único para o arquivo
        const extension = input.mimeType.split("/")[1] || "png";
        const fileName = `avatars/${ctx.user.id}-${Date.now()}.${extension}`;
        
        // Upload para S3
        const { url } = await storagePut(fileName, buffer, input.mimeType);
        
        // Atualizar URL no perfil do usuário
        await db.updateUserProfile(ctx.user.id, { avatarUrl: url });
        
        return { success: true, avatarUrl: url };
      }),
  }),

  // ========== DRAWS (SORTEIOS) ==========
  draws: router({
    list: publicProcedure.query(async () => {
      return db.getActiveDraws();
    }),
    
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const draw = await db.getDrawById(input.id);
        if (!draw) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Sorteio não encontrado" });
        }
        return draw;
      }),

    create: protectedProcedure
      .input(z.object({
        title: z.string(),
        description: z.string().optional(),
        prizeAmount: z.number(),
        ticketPrice: z.number(),
        targetAmount: z.number(),
        drawDate: z.date().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Apenas admin pode criar sorteios
        requireRole(ctx, ["admin"]);
        return db.createDraw(input);
      }),

    performDraw: protectedProcedure
      .input(z.object({
        drawId: z.number(),
        lotteryResult: z.string(), // Resultado da Loteria Federal
      }))
      .mutation(async ({ input, ctx }) => {
        // Apenas admin pode realizar sorteio
        requireRole(ctx, ["admin"]);

        const draw = await db.getDrawById(input.drawId);
        if (!draw) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Sorteio não encontrado" });
        }

        if (draw.status !== "closed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Sorteio ainda não foi fechado" });
        }

        // Buscar todos os bilhetes confirmados
        const allTickets = await db.getTicketsByDrawId(input.drawId);
        const confirmedTickets = allTickets.filter(t => t.paymentStatus === "confirmed");

        if (confirmedTickets.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Nenhum bilhete confirmado para sorteio" });
        }

        // Selecionar ganhador aleatório (simulação baseada no resultado da loteria)
        const winnerIndex = parseInt(input.lotteryResult.slice(-2)) % confirmedTickets.length;
        const winner = confirmedTickets[winnerIndex];

        // Atualizar sorteio com ganhador
        await db.updateDraw(input.drawId, {
          status: "drawn",
          winnerUserId: winner.userId,
          lotteryResult: input.lotteryResult,
        });

        // Creditar UTEFs ao ganhador
        await db.createOrUpdateUtefBalance(winner.userId, draw.prizeAmount);
        await db.createUtefTransaction({
          userId: winner.userId,
          amount: draw.prizeAmount,
          type: "prize",
          description: `Prêmio do sorteio: ${draw.title}`,
          relatedId: input.drawId,
        });

        return { success: true, winnerId: winner.userId, winnerTicket: winner.ticketNumber };
      }),
  }),

  // ========== TICKETS (BILHETES) ==========
  tickets: router({
    myTickets: protectedProcedure.query(async ({ ctx }) => {
      return db.getTicketsByUserId(ctx.user.id);
    }),

    purchase: protectedProcedure
      .input(z.object({
        drawId: z.number(),
        quantity: z.number().min(1),
        paymentMethod: z.enum(["pix", "credit_card", "boleto"]).default("pix"),
      }))
      .mutation(async ({ input, ctx }) => {
        const draw = await db.getDrawById(input.drawId);
        if (!draw) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Sorteio não encontrado" });
        }

        if (draw.status !== "active") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Sorteio não está ativo" });
        }

        const totalPaid = draw.ticketPrice * input.quantity;
        const ticketNumber = generateTicketNumber();
        
        // Criar ou buscar cliente no Asaas
        const asaasCustomer = await createOrUpdateAsaasCustomer({
          name: ctx.user.name || "Cliente",
          email: ctx.user.email || undefined,
          cpfCnpj: ctx.user.cpf || undefined,
          externalReference: `user_${ctx.user.id}`,
        });
        
        // Criar cobrança no Asaas
        const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const dueDateStr = dueDate.toISOString().split('T')[0]; // YYYY-MM-DD
        
        const asaasPayment = await createAsaasPayment({
          customer: asaasCustomer.id!,
          billingType: input.paymentMethod === "pix" ? "PIX" : input.paymentMethod === "credit_card" ? "CREDIT_CARD" : "BOLETO",
          value: totalPaid / 100, // Converter centavos para reais
          dueDate: dueDateStr,
          description: `${input.quantity} bilhete(s) - ${draw.title}`,
          externalReference: `ticket_purchase_${input.drawId}_${ctx.user.id}_${ticketNumber}`,
        });

        // Se for PIX, buscar QR Code
        let pixQrCode: string | undefined;
        let pixCopyPaste: string | undefined;
        
        if (input.paymentMethod === "pix" && asaasPayment.id) {
          const pixData = await getAsaasPixQrCode(asaasPayment.id);
          pixQrCode = pixData.encodedImage;
          pixCopyPaste = pixData.payload;
        }

        const ticket = await db.createTicket({
          drawId: input.drawId,
          userId: ctx.user.id,
          ticketNumber,
          quantity: input.quantity,
          totalPaid,
          paymentStatus: "pending",
          paymentMethod: input.paymentMethod,
          pixQrCode,
          pixCopyPaste,
          stripePaymentIntentId: asaasPayment.id, // Reutilizar campo para armazenar ID do Asaas
          stripeCheckoutSessionId: null, // Campo não usado com Asaas
        });

        return {
          ticket,
          asaasPaymentId: asaasPayment.id,
          invoiceUrl: asaasPayment.invoiceUrl,
          bankSlipUrl: asaasPayment.bankSlipUrl,
          pixQrCode,
          pixCopyPaste,
          totalPaid,
        };
      }),

    confirmPayment: protectedProcedure
      .input(z.object({
        ticketId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Simulação de confirmação de pagamento
        // Em produção, integrar com webhook do gateway de pagamento
        await db.updateTicket(input.ticketId, {
          paymentStatus: "confirmed",
        });

        // Atualizar estatísticas do sorteio
        const ticket = (await db.getTicketsByUserId(ctx.user.id)).find(t => t.id === input.ticketId);
        if (ticket) {
          const draw = await db.getDrawById(ticket.drawId);
          if (draw) {
            await db.updateDraw(ticket.drawId, {
              ticketsSold: draw.ticketsSold + ticket.quantity,
              currentAmount: draw.currentAmount + ticket.totalPaid,
            });
          }
        }

        return { success: true };
      }),
  }),

  // ========== UTEF ==========
  utef: router({
    balance: protectedProcedure.query(async ({ ctx }) => {
      const balance = await db.getUtefBalance(ctx.user.id);
      return balance?.balance || 0;
    }),

    transactions: protectedProcedure.query(async ({ ctx }) => {
      return db.getUtefTransactionsByUserId(ctx.user.id);
    }),

    purchase: protectedProcedure
      .input(z.object({
        amount: z.number().min(1),
        paymentMethod: z.enum(["pix", "credit_card", "boleto"]).default("pix"),
      }))
      .mutation(async ({ input, ctx }) => {
        // 1 UTEF = R$ 1,00
        const totalPrice = input.amount;
        const txId = `UTEF${Date.now()}${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
        
        // Criar ou buscar cliente no Asaas
        const asaasCustomer = await createOrUpdateAsaasCustomer({
          name: ctx.user.name || "Cliente",
          email: ctx.user.email || undefined,
          cpfCnpj: ctx.user.cpf || undefined,
          externalReference: `user_${ctx.user.id}`,
        });
        
        // Criar cobrança no Asaas
        const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const dueDateStr = dueDate.toISOString().split('T')[0]; // YYYY-MM-DD
        
        const asaasPayment = await createAsaasPayment({
          customer: asaasCustomer.id!,
          billingType: input.paymentMethod === "pix" ? "PIX" : input.paymentMethod === "credit_card" ? "CREDIT_CARD" : "BOLETO",
          value: totalPrice, // Já em reais
          dueDate: dueDateStr,
          description: `Compra de ${input.amount} UTEFs`,
          externalReference: `utef_purchase_${ctx.user.id}_${txId}`,
        });

        // Se for PIX, buscar QR Code
        let pixQrCode: string | undefined;
        let pixCopyPaste: string | undefined;
        
        if (input.paymentMethod === "pix" && asaasPayment.id) {
          const pixData = await getAsaasPixQrCode(asaasPayment.id);
          pixQrCode = pixData.encodedImage;
          pixCopyPaste = pixData.payload;
        }

        return {
          asaasPaymentId: asaasPayment.id,
          invoiceUrl: asaasPayment.invoiceUrl,
          bankSlipUrl: asaasPayment.bankSlipUrl,
          pixQrCode,
          pixCopyPaste,
          totalPrice,
        };
      }),
  }),

  // ========== PRODUCTS (PRODUTOS) ==========
  products: router({
    list: publicProcedure
      .input(z.object({
        category: z.enum(["real_estate", "financial", "nautical"]).optional(),
      }))
      .query(async ({ input }) => {
        return db.getProducts(input.category);
      }),

    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const product = await db.getProductById(input.id);
        if (!product) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado" });
        }
        return product;
      }),

    create: protectedProcedure
      .input(z.object({
        category: z.enum(["real_estate", "financial", "nautical"]),
        title: z.string(),
        description: z.string().optional(),
        priceUtef: z.number(),
        imageUrl: z.string().optional(),
        details: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Apenas admin pode criar produtos
        requireRole(ctx, ["admin"]);
        return db.createProduct(input);
      }),

    convert: protectedProcedure
      .input(z.object({
        productId: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        const product = await db.getProductById(input.productId);
        if (!product) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado" });
        }

        const balance = await db.getUtefBalance(ctx.user.id);
        if (!balance || balance.balance < product.priceUtef) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Saldo insuficiente de UTEF" });
        }

        // Debitar UTEFs
        await db.createOrUpdateUtefBalance(ctx.user.id, -product.priceUtef);
        await db.createUtefTransaction({
          userId: ctx.user.id,
          amount: -product.priceUtef,
          type: "conversion",
          description: `Conversão em: ${product.title}`,
          relatedId: product.id,
        });

        // Criar registro de conversão
        const conversion = await db.createProductConversion({
          userId: ctx.user.id,
          productId: product.id,
          utefAmount: product.priceUtef,
          status: "pending",
        });

        // Criar notificação
        await db.createNotification({
          userId: ctx.user.id,
          title: "Conversão Realizada",
          message: `Você converteu ${product.priceUtef} UTEFs em: ${product.title}`,
          type: "utef_update",
          relatedId: conversion.id,
          actionUrl: "/minhas-conversoes",
        });

        return { success: true, conversion };
      }),

    myConversions: protectedProcedure.query(async ({ ctx }) => {
      return db.getConversionsByUserId(ctx.user.id);
    }),
  }),

  // ========== CONSTRUCTION (OBRAS) ==========
  construction: router({
    // Listar obras do usuário
    myProjects: protectedProcedure.query(async ({ ctx }) => {
      return db.getProjectsByUserId(ctx.user.id);
    }),

    // Listar TODAS as obras (apenas admin)
    allProjects: protectedProcedure.query(async ({ ctx }) => {
      requireRole(ctx, ["admin"]);
      return db.getAllProjects();
    }),

    // Obter detalhes completos de uma obra (com etapas e fotos)
    getProjectDetails: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input, ctx }) => {
        const project = await db.getProjectWithDetails(input.projectId);
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
        }
        // Verificar se o usuário é o proprietário ou admin
        if (project.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        return project;
      }),

    // Criar nova obra
    createProject: protectedProcedure
      .input(z.object({
        title: z.string().min(1),
        address: z.string().optional(),
        projectType: z.string().optional(),
        totalArea: z.number().optional(),
        estimatedCost: z.number().optional(),
        startDate: z.date().optional(),
        estimatedEndDate: z.date().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const project = await db.createProject({
          ...input,
          userId: ctx.user.id,
          status: "planning",
          progress: 0,
        });
        return project;
      }),

    // Atualizar obra
    updateProject: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        title: z.string().optional(),
        address: z.string().optional(),
        projectType: z.string().optional(),
        totalArea: z.number().optional(),
        estimatedCost: z.number().optional(),
        actualCost: z.number().optional(),
        // Campos financeiros detalhados
        contractValue: z.number().optional(),
        contractType: z.string().optional(),
        contractorPayment: z.number().optional(),
        materialCost: z.number().optional(),
        lotCost: z.number().optional(),
        commissionCost: z.number().optional(),
        extrasCost: z.number().optional(),
        maintenanceCost: z.number().optional(),
        insuranceCost: z.number().optional(),
        balanceAmount: z.number().optional(),
        // Datas e status
        startDate: z.date().optional(),
        estimatedEndDate: z.date().optional(),
        actualEndDate: z.date().optional(),
        status: z.enum(["planning", "in_progress", "paused", "completed", "cancelled"]).optional(),
        progress: z.number().min(0).max(100).optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { projectId, ...updates } = input;
        const project = await db.getProjectById(projectId);
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
        }
        if (project.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        // Convert number fields to string for decimal columns in Drizzle
        const decimalFields = ['estimatedCost', 'actualCost', 'contractValue', 'contractorPayment', 'materialCost', 'lotCost', 'commissionCost', 'extrasCost', 'maintenanceCost', 'insuranceCost', 'balanceAmount'] as const;
        const converted: Record<string, any> = { ...updates };
        for (const field of decimalFields) {
          if (converted[field] !== undefined) {
            converted[field] = String(converted[field]);
          }
        }
        await db.updateProject(projectId, converted as any);
        return { success: true };
      }),

    // Deletar obra
    deleteProject: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const project = await db.getProjectById(input.projectId);
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
        }
        if (project.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        await db.deleteProject(input.projectId);
        return { success: true };
      }),

    // ========== ETAPAS ==========

    // Criar etapa
    createStage: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        name: z.string().min(1),
        description: z.string().optional(),
        orderIndex: z.number(),
        estimatedCost: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const project = await db.getProjectById(input.projectId);
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
        }
        if (project.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        const stage = await db.createStage(input);
        return stage;
      }),

    // Atualizar etapa
    updateStage: protectedProcedure
      .input(z.object({
        stageId: z.number(),
        name: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(["pending", "in_progress", "completed"]).optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        actualCost: z.number().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { stageId, ...updates } = input;
        const stage = await db.getStageById(stageId);
        if (!stage) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Etapa não encontrada" });
        }
        const project = await db.getProjectById(stage.projectId);
        if (!project || (project.userId !== ctx.user.id && ctx.user.role !== "admin")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        await db.updateStage(stageId, updates);
        return { success: true };
      }),

    // Deletar etapa
    deleteStage: protectedProcedure
      .input(z.object({ stageId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const stage = await db.getStageById(input.stageId);
        if (!stage) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Etapa não encontrada" });
        }
        const project = await db.getProjectById(stage.projectId);
        if (!project || (project.userId !== ctx.user.id && ctx.user.role !== "admin")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        await db.deleteStage(input.stageId);
        return { success: true };
      }),

    // ========== FOTOS ==========

    // Upload de foto (retorna URL para upload no S3)
    uploadPhoto: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        stageId: z.number().optional(),
        caption: z.string().optional(),
        takenAt: z.date(),
        imageUrl: z.string(), // URL da imagem já no S3
      }))
      .mutation(async ({ input, ctx }) => {
        const project = await db.getProjectById(input.projectId);
        if (!project) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Obra não encontrada" });
        }
        if (project.userId !== ctx.user.id && ctx.user.role !== "admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        const photo = await db.createPhoto({
          ...input,
          uploadedBy: ctx.user.id,
        });
        return photo;
      }),

    // Deletar foto
    deletePhoto: protectedProcedure
      .input(z.object({ photoId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // Buscar foto para verificar permissões
        const photos = await db.getPhotosByProjectId(0); // Workaround: buscar todas e filtrar
        const photo = photos.find(p => p.id === input.photoId);
        if (!photo) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Foto não encontrada" });
        }
        const project = await db.getProjectById(photo.projectId);
        if (!project || (project.userId !== ctx.user.id && ctx.user.role !== "admin")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Acesso negado" });
        }
        await db.deletePhoto(input.photoId);
        return { success: true };
      }),
  }),

  // ========== PROJECT BUDGET REQUESTS (ORÇAMENTOS) ==========
  budgetRequests: router({
    // Criar solicitação de orçamento (pública)
    create: publicProcedure
      .input(z.object({
        userId: z.number().optional(),
        name: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        city: z.string().optional(),
        projectType: z.string().optional(),
        hasLot: z.enum(["yes", "no", "not_sure"]).optional(),
        message: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const request = await db.createBudgetRequest({
          ...input,
          status: "pending",
        });
        
        // Notificar admin sobre novo orçamento
        await notifyOwner({
          title: "🏗️ Novo Orçamento Recebido",
          content: `Nome: ${input.name}\nEmail: ${input.email}\nTelefone: ${input.phone || 'Não informado'}\nCidade: ${input.city || 'Não informada'}\nTipo: ${input.projectType || 'Não especificado'}\nPossui lote: ${input.hasLot === 'yes' ? 'Sim' : input.hasLot === 'no' ? 'Não' : 'Não tem certeza'}\n\nMensagem: ${input.message || 'Nenhuma mensagem adicional'}`
        });
        
        // Enviar email de confirmação para o cliente
        const { sendEmail, budgetConfirmationTemplate } = await import("./_core/email-smtp.js");
        const template = budgetConfirmationTemplate({
          name: input.name,
          projectType: input.projectType,
          city: input.city,
        });
        await sendEmail({
          to: input.email,
          subject: template.subject,
          html: template.html,
          recipientName: input.name,
          templateType: 'budget_confirmation',
          metadata: {
            projectType: input.projectType || "Projeto personalizado",
            city: input.city || "Não informada",
            budgetId: request.id
          }
        });
        
        return request;
      }),

    // Listar TODOS os orçamentos (apenas admin)
    getAll: protectedProcedure.query(async ({ ctx }) => {
      requireRole(ctx, ["admin"]);
      return db.getAllBudgetRequests();
    }),

    // Obter orçamento por ID (apenas admin)
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const request = await db.getBudgetRequestById(input.id);
        if (!request) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
        }
        return request;
      }),

    // Atualizar orçamento (apenas admin)
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending", "contacted", "in_negotiation", "converted", "cancelled"]).optional(),
        adminNotes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const { id, ...updates } = input;
        
        // Buscar dados do orçamento antes de atualizar
        const request = await db.getBudgetRequestById(id);
        if (!request) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Orçamento não encontrado" });
        }
        
        await db.updateBudgetRequest(id, updates);
        
        // Enviar email de atualização se o status mudou
        if (input.status && input.status !== request.status) {
          const { sendBudgetUpdateEmail } = await import("./_core/email-smtp.js");
          const statusLabels: Record<string, string> = {
            pending: "Pendente",
            contacted: "Contatado",
            in_negotiation: "Em Negociação",
            converted: "Convertido",
            cancelled: "Cancelado"
          };
          
          await sendBudgetUpdateEmail({
            name: request.name,
            email: request.email,
            status: statusLabels[input.status] || input.status,
            notes: input.adminNotes,
            budgetId: id
          });
        }
        
        return { success: true };
      }),

    // Deletar orçamento (apenas admin)
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.deleteBudgetRequest(input.id);
        return { success: true };
      }),
  }),

  // Analytics Router
  analytics: router({
    // Obter estatísticas gerais (apenas admin)
    getStats: protectedProcedure
      .query(async ({ ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.getAnalyticsStats();
      }),

    // Obter orçamentos por status (apenas admin)
    getBudgetRequestsByStatus: protectedProcedure
      .query(async ({ ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.getBudgetRequestsByStatus();
      }),

    // Obter obras por status (apenas admin)
    getProjectsByStatus: protectedProcedure
      .query(async ({ ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.getProjectsByStatus();
      }),

    // Obter orçamentos recentes (apenas admin)
    getRecentBudgetRequests: protectedProcedure
      .input(z.object({ limit: z.number().optional() }))
      .query(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.getRecentBudgetRequests(input.limit);
      }),
  }),

  // Email Logs Router
  emails: router({
    // Listar todos os emails (apenas admin)
    getAll: protectedProcedure
      .query(async ({ ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.getAllEmailLogs();
      }),

    // Listar emails recentes (apenas admin)
    getRecent: protectedProcedure
      .input(z.object({ limit: z.number().optional() }))
      .query(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.getRecentEmailLogs(input.limit);
      }),

    // Obter email por ID (apenas admin)
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const email = await db.getEmailLogById(input.id);
        if (!email) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Email não encontrado" });
        }
        return email;
      }),
  }),

  // Notificações In-App
  notifications: router({
    // Listar todas as notificações do usuário
    getAll: protectedProcedure.query(async ({ ctx }) => {
      return db.getUserNotifications(ctx.user.id);
    }),

    // Listar notificações não lidas
    getUnread: protectedProcedure.query(async ({ ctx }) => {
      return db.getUnreadNotifications(ctx.user.id);
    }),

    // Contar notificações não lidas
    getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
      return db.getUnreadNotificationCount(ctx.user.id);
    }),

    // Marcar notificação como lida
    markAsRead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // Verificar se a notificação pertence ao usuário
        const notifications = await db.getUserNotifications(ctx.user.id);
        const notification = notifications.find(n => n.id === input.id);
        
        if (!notification) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Notificação não encontrada" });
        }
        
        await db.markNotificationAsRead(input.id);
        return { success: true };
      }),

    // Marcar todas as notificações como lidas
    markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
      await db.markAllNotificationsAsRead(ctx.user.id);
      return { success: true };
    }),
  }),

  // ========== CRM — LEADS ==========
  leads: router({
    list: protectedProcedure
      .input(z.object({
        stage: z.string().optional(),
        responsible: z.string().optional(),
        temperature: z.string().optional(),
        city: z.string().optional(),
      }).optional())
      .query(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.getAllLeads(input || {});
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const lead = await db.getLeadById(input.id);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
        const [activities, documents, followUps] = await Promise.all([
          db.getLeadActivities(input.id),
          db.getLeadDocuments(input.id),
          db.getLeadFollowUps(input.id),
        ]);
        return { ...lead, activities, documents, followUps };
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(2),
        phone: z.string().min(8),
        email: z.string().email().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        type: z.enum(["new_lead","in_process","broker","employee","supplier","vip"]).optional(),
        temperature: z.enum(["cold","warm","hot"]).optional(),
        income: z.string().optional(),
        incomeType: z.enum(["formal","informal","irpf"]).optional(),
        fgtsAmount: z.string().optional(),
        pisFgts: z.string().optional(),
        hasSpouse: z.number().optional(),
        spouseName: z.string().optional(),
        sourceChannel: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        // Roteamento automático por cidade
        let responsible: "sarah" | "vinicius" | "bianca" = "sarah";
        const city = (input.city || "").toLowerCase();
        if (city.includes("canaa") || city.includes("parauapebas")) responsible = "bianca";
        const lead = await db.createLead({
          ...input,
          responsible,
          stage: "lead_new",
          temperature: input.temperature || "cold",
          type: input.type || "new_lead",
        } as any);
        await db.addLeadActivity({
          leadId: lead.id,
          type: "status_change",
          description: "Lead criado no sistema",
          performedBy: "vinicius",
        });
        return lead;
      }),

    createPublic: publicProcedure
      .input(z.object({
        name: z.string().min(2),
        phone: z.string().min(8),
        email: z.string().email().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        sourceChannel: z.string(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        let responsible: "sarah" | "vinicius" | "bianca" = "sarah";
        const city = (input.city || "").toLowerCase();
        if (city.includes("canaa") || city.includes("parauapebas")) responsible = "bianca";
        const lead = await db.createLead({
          name: input.name,
          phone: input.phone,
          email: input.email,
          city: input.city,
          state: input.state,
          notes: input.notes,
          sourceChannel: input.sourceChannel,
          responsible,
          stage: "lead_new",
          temperature: "cold",
          type: "new_lead",
        } as any);
        await db.addLeadActivity({
          leadId: lead.id,
          type: "status_change",
          description: "Lead criado via formulário público do site",
          performedBy: "site",
        });
        return { success: true };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        stage: z.string().optional(),
        temperature: z.enum(["cold","warm","hot"]).optional(),
        responsible: z.enum(["sarah","vinicius","bianca"]).optional(),
        cpfStatus: z.enum(["clean","restricted","unknown"]).optional(),
        simulationValue: z.union([z.string(), z.number()]).optional(),
        approvedValue: z.union([z.string(), z.number()]).optional(),
        contractType: z.enum(["obra","financing","both"]).optional(),
        rejectionReason: z.string().optional(),
        followupDate: z.string().optional(),
        notes: z.string().optional(),
        adminNotes: z.string().optional(),
        income: z.union([z.string(), z.number()]).optional(),
        incomeType: z.enum(["formal","informal","irpf"]).optional(),
        fgtsAmount: z.string().optional(),
        pisFgts: z.string().optional(),
        fgts: z.boolean().optional(),
        hasSpouse: z.union([z.boolean(), z.number()]).optional(),
        spouseName: z.string().optional(),
        incomeComposition: z.union([z.boolean(), z.number()]).optional(),
        interest: z.enum(["house","lot","financing","construction"]).optional(),
        type: z.string().optional(),
        lgpdConsent: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const { id, stage, ...data } = input;
        const lead = await db.getLeadById(id);
        if (!lead) throw new TRPCError({ code: "NOT_FOUND" });
        // Convert number fields to string for decimal columns
        const dbData: any = {
          ...data,
          stage: stage as any,
          income: data.income !== undefined ? data.income.toString() : undefined,
          simulationValue: data.simulationValue !== undefined ? data.simulationValue.toString() : undefined,
          approvedValue: data.approvedValue !== undefined ? data.approvedValue.toString() : undefined,
          hasSpouse: data.hasSpouse !== undefined ? (data.hasSpouse ? 1 : 0) : undefined,
          fgts: data.fgts !== undefined ? (data.fgts ? 1 : 0) : undefined,
          incomeComposition: data.incomeComposition !== undefined ? (data.incomeComposition ? 1 : 0) : undefined,
          followupDate: data.followupDate ? new Date(data.followupDate) : undefined,
        };
        await db.updateLead(id, dbData);
        if (stage && stage !== lead.stage) {
          await db.addLeadActivity({
            leadId: id,
            type: "status_change",
            description: `Estágio alterado de "${lead.stage}" para "${stage}"`,
            performedBy: "vinicius",
          });
        }
        return { success: true };
      }),

    addActivity: protectedProcedure
      .input(z.object({
        leadId: z.number(),
        type: z.enum(["message","call","document","status_change","note","handoff","follow_up","simulation","caixa_register"]),
        description: z.string(),
        performedBy: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.addLeadActivity({ ...input, performedBy: input.performedBy || "vinicius" });
        return { success: true };
      }),

    addDocument: protectedProcedure
      .input(z.object({
        leadId: z.number(),
        type: z.enum(["rg","cnh","address_proof","income_proof_formal","income_proof_irpf","fgts","spouse_docs","pis","other"]),
        fileName: z.string().optional(),
        fileUrl: z.string().optional(),
        status: z.enum(["pending","received","approved","rejected"]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.addLeadDocument({ ...input, status: input.status || "received", uploadedAt: new Date() });
        return { success: true };
      }),

    updateDocument: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending","received","approved","rejected"]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const { id, ...data } = input;
        await db.updateLeadDocument(id, { ...data, reviewedAt: new Date() });
        return { success: true };
      }),

    stats: protectedProcedure
      .query(async ({ ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.getLeadStats();
      }),
  }),

  // ========== EMPREITEIROS ==========
  // ========== TAREFAS ==========
  tasks: router({
    list: protectedProcedure
      .input(z.object({
        assignedTo: z.string().optional(),
        status: z.string().optional(),
      }).optional())
      .query(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.getAllTasks(input?.assignedTo);
      }),

    create: protectedProcedure
      .input(z.object({
        title: z.string().min(2),
        description: z.string().optional(),
        assignedTo: z.string(),
        relatedType: z.enum(["lead","obra","budget","financial","general"]).optional(),
        relatedId: z.number().optional(),
        priority: z.enum(["low","medium","high","critical"]).optional(),
        slaHours: z.number().optional(),
        dueAt: z.union([z.string(), z.date()]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.createTask({
          ...input,
          dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
          priority: input.priority || "medium",
          status: "pending",
        } as any);
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pending","in_progress","done","cancelled"]).optional(),
        priority: z.enum(["low","medium","high","critical"]).optional(),
        escalatedToVinicius: z.number().optional(),
        dueAt: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const { id, ...data } = input;
        await db.updateTask(id, {
          ...data,
          dueAt: data.dueAt ? new Date(data.dueAt) : undefined,
          completedAt: data.status === "done" ? new Date() : undefined,
        } as any);
        return { success: true };
      }),
  }),

  // ========== CORRETORES ==========
  brokerCommissions: router({
    list: protectedProcedure
      .input(z.object({
        brokerName: z.string().optional(),
        status: z.string().optional(),
      }).optional())
      .query(async ({ ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.getAllBrokerCommissions();
      }),

    create: protectedProcedure
      .input(z.object({
        brokerName: z.string(),
        clientName: z.string(),
        projectName: z.string().optional(),
        totalAmount: z.number(),
        installment1: z.number().optional(),
        installment2: z.number().optional(),
        installment3: z.number().optional(),
        installment4: z.number().optional(),
        dueDate1: z.union([z.string(), z.date()]).optional(),
        dueDate2: z.union([z.string(), z.date()]).optional(),
        dueDate3: z.union([z.string(), z.date()]).optional(),
        dueDate4: z.union([z.string(), z.date()]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.createBrokerCommission({
          brokerName: input.brokerName,
          clientName: input.clientName,
          projectName: input.projectName,
          totalCommission: input.totalAmount.toString(),
          installment1Value: input.installment1?.toString(),
          installment2Value: input.installment2?.toString(),
          installment3Value: input.installment3?.toString(),
          installment4Value: input.installment4?.toString(),
          installment1DueDate: input.dueDate1 ? new Date(input.dueDate1) : undefined,
          installment2DueDate: input.dueDate2 ? new Date(input.dueDate2) : undefined,
          installment3DueDate: input.dueDate3 ? new Date(input.dueDate3) : undefined,
          installment4DueDate: input.dueDate4 ? new Date(input.dueDate4) : undefined,
          status: "pending",
        } as any);
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        paidDate1: z.union([z.string(), z.date()]).optional(),
        paidDate2: z.union([z.string(), z.date()]).optional(),
        paidDate3: z.union([z.string(), z.date()]).optional(),
        paidDate4: z.union([z.string(), z.date()]).optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const { id, notes, ...dates } = input;
        const data: Record<string, any> = { notes };
        if (dates.paidDate1) data.installment1Paid = new Date(dates.paidDate1);
        if (dates.paidDate2) data.installment2Paid = new Date(dates.paidDate2);
        if (dates.paidDate3) data.installment3Paid = new Date(dates.paidDate3);
        if (dates.paidDate4) data.installment4Paid = new Date(dates.paidDate4);
        await db.updateBrokerCommission(id, data as any);
        return { success: true };
      }),
  }),


  // ========== MEDIÇÕES DE OBRA ==========
  obraMedicoes: router({
    list: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const db = await import("./db.js").then(m => m.getDb());
        if (!db) return [];
        const { sql } = await import("drizzle-orm");
        try {
          const rows = await db.execute(sql`
            SELECT * FROM obra_medicoes WHERE project_id = ${input.projectId} ORDER BY created_at ASC
          `);
          const arr = (rows as any)[0] || (Array.isArray(rows) ? rows : []);
          return (Array.isArray(arr) ? arr : []).map((r: any) => ({
            id: r.id,
            projectId: r.project_id,
            tipo: r.tipo || "pls",
            dataPrevista: r.data_prevista ? new Date(r.data_prevista) : null,
            dataRecebimentoCef: r.data_recebimento_cef ? new Date(r.data_recebimento_cef) : null,
            valorCef: r.valor_cef ? Number(r.valor_cef) : null,
            dataTransferencia: r.data_transferencia ? new Date(r.data_transferencia) : null,
            valorTransferido: r.valor_transferido ? Number(r.valor_transferido) : null,
            status: r.status || "pending",
            empreiteiro: r.empreiteiro || null,
            valorPagoEmpreiteiro: r.valor_pago_empreiteiro ? Number(r.valor_pago_empreiteiro) : null,
            notes: r.notes || null,
          }));
        } catch {
          return [];
        }
      }),

    create: protectedProcedure
      .input(z.object({
        projectId: z.number(),
        tipo: z.enum(["pls", "rae", "marco_30", "marco_85", "final", "repactuacao"]),
        dataPrevista: z.date().optional(),
        valorCef: z.number().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const db = await import("./db.js").then(m => m.getDb());
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { sql } = await import("drizzle-orm");
        await db.execute(sql`
          INSERT INTO obra_medicoes (project_id, tipo, data_prevista, valor_cef, status, notes, created_at, updated_at)
          VALUES (
            ${input.projectId},
            ${input.tipo},
            ${input.dataPrevista ?? null},
            ${input.valorCef ?? null},
            'pending',
            ${input.notes ?? null},
            NOW(), NOW()
          )
        `);
        return { success: true };
      }),

    confirmReceipt: protectedProcedure
      .input(z.object({
        id: z.number(),
        cefPaid: z.boolean().optional(),
        dataRecebimentoCef: z.date().optional(),
        valorTransferido: z.number().optional(),
        dataTransferencia: z.date().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const db = await import("./db.js").then(m => m.getDb());
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { sql } = await import("drizzle-orm");
        if (input.cefPaid) {
          await db.execute(sql`
            UPDATE obra_medicoes
            SET status = 'cef_paid', data_recebimento_cef = ${input.dataRecebimentoCef ?? new Date()}, updated_at = NOW()
            WHERE id = ${input.id}
          `);
        } else {
          await db.execute(sql`
            UPDATE obra_medicoes
            SET status = 'received',
                valor_transferido = ${input.valorTransferido ?? null},
                data_transferencia = ${input.dataTransferencia ?? new Date()},
                updated_at = NOW()
            WHERE id = ${input.id}
          `);
        }
        return { success: true };
      }),

    payContractor: protectedProcedure
      .input(z.object({
        id: z.number(),
        valorPagoEmpreiteiro: z.number(),
        empreiteiro: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const db = await import("./db.js").then(m => m.getDb());
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const { sql } = await import("drizzle-orm");
        await db.execute(sql`
          UPDATE obra_medicoes
          SET status = 'contractor_paid',
              valor_pago_empreiteiro = ${input.valorPagoEmpreiteiro},
              empreiteiro = ${input.empreiteiro ?? null},
              updated_at = NOW()
          WHERE id = ${input.id}
        `);
        return { success: true };
      }),
  }),

  // ========== TRANSAÇÕES FINANCEIRAS ==========
  financialTransactions: router({
    list: protectedProcedure
      .input(z.object({
        type: z.string().optional(),
        responsible: z.string().optional(),
      }).optional())
      .query(async ({ ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.getAllFinancialTransactions ? db.getAllFinancialTransactions() : [];
      }),

    create: protectedProcedure
      .input(z.object({
        type: z.enum(["income","expense","commission","salary","contractor_payment"]),
        amount: z.number(),
        description: z.string(),
        category: z.string().optional(),
        responsible: z.string().optional(),
        paidAt: z.union([z.string(), z.date()]).optional(),
        referenceId: z.number().optional(),
        referenceType: z.string().optional(),
        notes: z.string().optional(),
        status: z.enum(["pending", "paid", "cancelled"]).optional(),
        dueDate: z.union([z.string(), z.date()]).optional(),
        paymentMethod: z.string().optional(),
        externalReference: z.string().optional(),
        competency: z.string().optional(),
        vendor: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        if (db.createFinancialTransaction) {
          return db.createFinancialTransaction({
            ...input,
            amount: input.amount.toString(),
            paidAt: input.paidAt ? new Date(input.paidAt) : undefined,
            dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
          } as any);
        }
        return { success: true };
      }),

    updateStatus: protectedProcedure
      .input(z.object({ id: z.number(), status: z.enum(["pending", "paid", "cancelled"]) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateFinancialTransactionStatus(input.id, input.status);
        return { success: true };
      }),
  }),

  // ========== BPO (terceirização contábil) ==========
  bpo: router({
    clientes: router({
      list: protectedProcedure.query(async ({ ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        return db.getAllBpoClients();
      }),

      create: protectedProcedure
        .input(z.object({
          razaoSocial: z.string().min(2),
          cnpj: z.string().optional(),
          cpf: z.string().optional(),
          responsavel: z.string().min(1),
          email: z.string().optional(),
          telefone: z.string().min(1),
          servicos: z.array(z.string()).default([]),
          honorarios: z.number(),
          diaVencimento: z.number().optional(),
          dataInicio: z.union([z.string(), z.date()]),
          observacoes: z.string().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
          requireRole(ctx, ["admin"]);
          return db.createBpoClient({
            ...input,
            servicos: JSON.stringify(input.servicos),
            honorarios: input.honorarios.toString(),
            dataInicio: new Date(input.dataInicio),
          } as any);
        }),

      updateStatus: protectedProcedure
        .input(z.object({ id: z.number(), status: z.enum(["ativo", "pausado", "encerrado"]) }))
        .mutation(async ({ input, ctx }) => {
          requireRole(ctx, ["admin"]);
          await db.updateBpoClientStatus(input.id, input.status);
          return { success: true };
        }),
    }),

    lancamentos: router({
      list: protectedProcedure.query(async ({ ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        return db.getAllBpoLancamentos();
      }),

      create: protectedProcedure
        .input(z.object({
          clienteId: z.number().optional(),
          clienteNomeLivre: z.string().optional(),
          tipo: z.enum(["honorario", "despesa", "reembolso"]),
          descricao: z.string().min(1),
          valor: z.number(),
          vencimento: z.union([z.string(), z.date()]),
          competencia: z.string().min(7).max(7),
          centroCustos: z.string().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
          requireRole(ctx, STAFF_ROLES);
          return db.createBpoLancamento({
            ...input,
            valor: input.valor.toString(),
            vencimento: new Date(input.vencimento),
          } as any);
        }),

      marcarPago: protectedProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input, ctx }) => {
          requireRole(ctx, STAFF_ROLES);
          await db.marcarBpoLancamentoPago(input.id);
          return { success: true };
        }),
    }),

    dre: protectedProcedure.query(async ({ ctx }) => {
      requireRole(ctx, STAFF_ROLES);
      const lancamentos = await db.getAllBpoLancamentos();
      const map = new Map<string, { cobrancas: number; despesas: number }>();
      for (const l of lancamentos) {
        const entry = map.get(l.competencia) ?? { cobrancas: 0, despesas: 0 };
        const valor = Number(l.valor);
        if (l.tipo === "despesa") entry.despesas += valor;
        else entry.cobrancas += valor;
        map.set(l.competencia, entry);
      }
      return Array.from(map.entries())
        .map(([competencia, v]) => ({ competencia, ...v, resultado: v.cobrancas - v.despesas }))
        .sort((a, b) => b.competencia.localeCompare(a.competencia));
    }),
  }),

  // ========== Pluggy (credenciais de integração bancária) ==========
  pluggySettings: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      requireRole(ctx, ["admin"]);
      const setting = await db.getPluggySetting();
      return { configured: Boolean(setting?.clientIdEncrypted), active: Boolean(setting?.isActive) };
    }),

    save: protectedProcedure
      .input(z.object({ clientId: z.string().trim().min(1), clientSecret: z.string().trim().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const token = await authenticatePluggy(input.clientId, input.clientSecret);
        if (!token) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Credenciais Pluggy inválidas ou API indisponível" });
        }
        await db.savePluggySetting({
          clientIdEncrypted: encryptSecret(input.clientId),
          clientSecretEncrypted: encryptSecret(input.clientSecret),
          isActive: true,
        });
        return { success: true };
      }),
  }),

  // ========== Bancário (contas e transações) ==========
  bancario: router({
    contas: router({
      list: protectedProcedure.query(async ({ ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        return db.getAllBankAccounts();
      }),

      create: protectedProcedure
        .input(z.object({
          banco: z.string().min(1),
          agencia: z.string().optional(),
          conta: z.string().min(1),
          tipo: z.enum(["corrente", "poupanca", "pagamento", "investimento"]).optional(),
          descricao: z.string().optional(),
          saldoAtual: z.number().optional(),
          pluggyAccountId: z.string().optional(),
          webhookUrl: z.string().optional(),
        }))
        .mutation(async ({ input, ctx }) => {
          requireRole(ctx, ["admin"]);
          return db.createBankAccount({
            ...input,
            saldoAtual: (input.saldoAtual ?? 0).toString(),
          } as any);
        }),

      delete: protectedProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ input, ctx }) => {
          requireRole(ctx, ["admin"]);
          await db.deleteBankAccount(input.id);
          return { success: true };
        }),

      atualizarSaldo: protectedProcedure
        .input(z.object({ id: z.number(), saldo: z.number() }))
        .mutation(async ({ input, ctx }) => {
          requireRole(ctx, STAFF_ROLES);
          await db.updateBankAccountSaldo(input.id, input.saldo);
          return { success: true };
        }),
    }),

    transacoes: router({
      listByConta: protectedProcedure
        .input(z.object({ accountId: z.number() }))
        .query(async ({ input, ctx }) => {
          requireRole(ctx, STAFF_ROLES);
          return db.getBankTransactionsByAccount(input.accountId);
        }),

      atualizarStatus: protectedProcedure
        .input(z.object({ id: z.number(), status: z.enum(["pendente", "conciliado", "ignorado"]) }))
        .mutation(async ({ input, ctx }) => {
          requireRole(ctx, STAFF_ROLES);
          await db.updateBankTransactionStatus(input.id, input.status);
          return { success: true };
        }),
    }),

    sincronizar: protectedProcedure
      .input(z.object({ contaId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        const conta = await db.getBankAccountById(input.contaId);
        if (!conta) throw new TRPCError({ code: "NOT_FOUND", message: "Conta não encontrada" });

        if (!conta.pluggyAccountId) {
          return { ok: false, configurado: false, mensagem: "Esta conta não tem um pluggyAccountId configurado." };
        }

        const setting = await db.getPluggySetting();
        if (!setting?.isActive) {
          return {
            ok: false,
            configurado: false,
            mensagem: "Configure as credenciais Pluggy em Configurações para sincronização automática.",
          };
        }

        const token = await authenticatePluggy(
          decryptSecret(setting.clientIdEncrypted),
          decryptSecret(setting.clientSecretEncrypted)
        );
        if (!token) {
          return { ok: false, configurado: true, mensagem: "Não foi possível autenticar com a Pluggy. Verifique as credenciais." };
        }

        const transacoes = await fetchPluggyTransactions(token, conta.pluggyAccountId);
        const sincronizados = await db.upsertBankTransactions(
          conta.id,
          transacoes.map((t) => ({
            data: new Date(t.data),
            descricao: t.descricao,
            valor: t.valor.toString(),
            tipo: t.tipo,
            categoria: t.categoria,
            externalId: t.externalId,
          })) as any
        );

        const novoSaldo = await fetchPluggyAccountBalance(token, conta.pluggyAccountId);
        await db.updateBankAccountSaldo(conta.id, novoSaldo ?? Number(conta.saldoAtual));

        return { ok: true, sincronizados, saldo: novoSaldo ?? Number(conta.saldoAtual) };
      }),
  }),

  // ========== IMÓVEIS ==========
  imoveis: router({
    list: publicProcedure
      .input(z.object({
        status: z.string().optional(),
        tipo: z.string().optional(),
        cidade: z.string().optional(),
        adminView: z.boolean().optional(),
      }).optional())
      .query(async ({ input, ctx }) => {
        const isAdmin = ctx.user?.role === "admin";
        return db.getAllImoveis({
          status: input?.status,
          tipo: input?.tipo,
          cidade: input?.cidade,
          publicadoOnly: !(input?.adminView && isAdmin),
        });
      }),

    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getImovelById(input.id);
      }),

    getBySlug: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        return db.getImovelBySlug(input.slug);
      }),

    create: protectedProcedure
      .input(z.object({
        slug: z.string().min(1),
        titulo: z.string().min(2),
        descricao: z.string().optional(),
        tipo: z.string().min(1),
        status: z.enum(["disponivel", "reservado", "vendido", "alugado"]).optional(),
        preco: z.number(),
        quartos: z.number().optional(),
        banheiros: z.number().optional(),
        vagas: z.number().optional(),
        areaM2: z.number().optional(),
        endereco: z.string().optional(),
        bairro: z.string().optional(),
        cidade: z.string().min(1),
        estado: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        fotos: z.string().optional(),
        destaque: z.boolean().optional(),
        publicadoSite: z.boolean().optional(),
        publicadoZap: z.boolean().optional(),
        publicadoOlx: z.boolean().optional(),
        publicadoViva: z.boolean().optional(),
        publicadoChavesNaMao: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.createImovel({
          ...input,
          preco: input.preco.toString(),
          areaM2: input.areaM2?.toString(),
          latitude: input.latitude?.toString(),
          longitude: input.longitude?.toString(),
        } as any);
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        titulo: z.string().optional(),
        descricao: z.string().optional(),
        tipo: z.string().optional(),
        status: z.enum(["disponivel", "reservado", "vendido", "alugado"]).optional(),
        preco: z.number().optional(),
        quartos: z.number().optional(),
        banheiros: z.number().optional(),
        vagas: z.number().optional(),
        areaM2: z.number().optional(),
        endereco: z.string().optional(),
        bairro: z.string().optional(),
        cidade: z.string().optional(),
        estado: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        fotos: z.string().optional(),
        destaque: z.boolean().optional(),
        publicadoSite: z.boolean().optional(),
        publicadoZap: z.boolean().optional(),
        publicadoOlx: z.boolean().optional(),
        publicadoViva: z.boolean().optional(),
        publicadoChavesNaMao: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const { id, ...data } = input;
        await db.updateImovel(id, {
          ...data,
          preco: data.preco?.toString(),
          areaM2: data.areaM2?.toString(),
          latitude: data.latitude?.toString(),
          longitude: data.longitude?.toString(),
        } as any);
        return { success: true };
      }),
  }),

  avaliacoes: router({
    list: protectedProcedure
      .input(z.object({
        status: z.string().optional(),
        tipo: z.string().optional(),
        cidade: z.string().optional(),
      }).optional())
      .query(async ({ input, ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        return db.getAllAvaliacoes(input);
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        const avaliacao = await db.getAvaliacaoById(input.id);
        if (!avaliacao) throw new TRPCError({ code: "NOT_FOUND" });
        return avaliacao;
      }),

    create: protectedProcedure
      .input(z.object({
        tipo: z.string(),
        finalidade: z.string(),
        clienteNome: z.string(),
        clienteCpf: z.string().optional(),
        clienteTel: z.string(),
        clienteEmail: z.string().optional(),
        endereco: z.string(),
        bairro: z.string(),
        cidade: z.string(),
        estado: z.string(),
        areaConstruida: z.number().optional(),
        areaTerreno: z.number().optional(),
        quartos: z.number().optional(),
        banheiros: z.number().optional(),
        vagas: z.number().optional(),
        metodologia: z.string().optional(),
        avaliador: z.string(),
        dataVistoria: z.string().optional(),
        prazoEntrega: z.string().optional(),
        observacoes: z.string().optional(),
        valorServico: z.number().optional(),
        leadId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        return db.createAvaliacao({
          ...input,
          areaConstruida: input.areaConstruida?.toString(),
          areaTerreno: input.areaTerreno?.toString(),
          valorServico: input.valorServico?.toString(),
          dataVistoria: input.dataVistoria ? new Date(input.dataVistoria) : undefined,
          prazoEntrega: input.prazoEntrega ? new Date(input.prazoEntrega) : undefined,
        } as any);
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        tipo: z.string().optional(),
        finalidade: z.string().optional(),
        status: z.enum(["solicitada", "vistoria", "elaboracao", "revisao", "entregue", "cancelada"]).optional(),
        clienteNome: z.string().optional(),
        clienteCpf: z.string().optional(),
        clienteTel: z.string().optional(),
        clienteEmail: z.string().optional(),
        endereco: z.string().optional(),
        bairro: z.string().optional(),
        cidade: z.string().optional(),
        estado: z.string().optional(),
        areaConstruida: z.number().optional(),
        areaTerreno: z.number().optional(),
        quartos: z.number().optional(),
        banheiros: z.number().optional(),
        vagas: z.number().optional(),
        caracteristicas: z.string().optional(),
        metodologia: z.string().optional(),
        valorEstimado: z.number().optional(),
        avaliador: z.string().optional(),
        dataVistoria: z.string().optional(),
        prazoEntrega: z.string().optional(),
        observacoes: z.string().optional(),
        laudo: z.string().optional(),
        documentos: z.string().optional(),
        sugestaoJson: z.string().optional(),
        valorServico: z.number().optional(),
        leadId: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        const { id, ...data } = input;
        if (data.status === "entregue") {
          (data as any).dataEntrega = new Date();
        }
        await db.updateAvaliacao(id, {
          ...data,
          areaConstruida: data.areaConstruida?.toString(),
          areaTerreno: data.areaTerreno?.toString(),
          valorEstimado: data.valorEstimado?.toString(),
          valorServico: data.valorServico?.toString(),
          dataVistoria: data.dataVistoria ? new Date(data.dataVistoria) : undefined,
          prazoEntrega: data.prazoEntrega ? new Date(data.prazoEntrega) : undefined,
        } as any);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.deleteAvaliacao(input.id);
        return { success: true };
      }),

    getChecklistCatalog: protectedProcedure
      .input(z.object({ tipo: z.enum(["imovel", "terreno"]) }))
      .query(({ input }) => {
        return {
          groups: getChecklistGroups(input.tipo),
          estadoGeralOptions: getEstadoGeralOptions(input.tipo),
        };
      }),

    updateChecklist: protectedProcedure
      .input(z.object({
        id: z.number(),
        tipoChecklist: z.enum(["imovel", "terreno"]),
        estadoGeral: z.string().optional().default(""),
        items: z.record(z.string(), z.object({
          ok: z.boolean().nullable(),
          nota: z.string(),
        })),
        fotos: z.array(z.string()).max(CHECKLIST_MAX_FOTOS),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        const { id, ...checklist } = input;
        await db.updateAvaliacao(id, { caracteristicas: JSON.stringify(checklist) });
        return { success: true };
      }),

    sugerirValor: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        const avaliacao = await db.getAvaliacaoById(input.id);
        if (!avaliacao) throw new TRPCError({ code: "NOT_FOUND" });

        const sugestao = await gerarSugestaoValor({
          endereco: avaliacao.endereco,
          bairro: avaliacao.bairro,
          cidade: avaliacao.cidade,
          estado: avaliacao.estado,
          tipo: avaliacao.tipo,
          areaConstruida: avaliacao.areaConstruida ? Number(avaliacao.areaConstruida) : null,
          areaTerreno: avaliacao.areaTerreno ? Number(avaliacao.areaTerreno) : null,
          quartos: avaliacao.quartos,
          banheiros: avaliacao.banheiros,
          caracteristicas: avaliacao.caracteristicas,
        });

        await db.updateAvaliacao(input.id, { sugestaoJson: JSON.stringify(sugestao) });
        return sugestao;
      }),
  }),

  agregador: router({
    listPublic: publicProcedure
      .query(async () => {
        const items = await db.getAllAgregadorImoveis({ status: "verificado" });
        return items.map((i) => ({
          id: i.id,
          titulo: i.titulo,
          descricao: i.descricao,
          preco: i.preco,
          precoTexto: i.precoTexto,
          areaM2: i.areaM2,
          tipo: i.tipo,
          bairro: i.bairro,
          cidade: i.cidade,
          fonte: i.fonte,
          urlFonte: i.urlFonte,
          imagens: i.imagens,
          documentoTipo: i.documentoTipo,
          contatoTel: i.contatoTel,
        }));
      }),

    scrape: protectedProcedure
      .input(z.object({ url: z.string() }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        return scrapeUrl(input.url);
      }),

    list: protectedProcedure
      .input(z.object({
        status: z.string().optional(),
        fonte: z.string().optional(),
      }).optional())
      .query(async ({ input, ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        return db.getAllAgregadorImoveis(input);
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        const item = await db.getAgregadorImovelById(input.id);
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    create: protectedProcedure
      .input(z.object({
        titulo: z.string(),
        descricao: z.string().optional(),
        preco: z.number().optional(),
        precoTexto: z.string().optional(),
        areaM2: z.number().optional(),
        tipo: z.string().optional(),
        bairro: z.string().optional(),
        cidade: z.string(),
        estado: z.string(),
        fonte: z.enum(["olx", "zapimoveis", "vivareal", "facebook", "instagram", "google", "direto", "outro"]),
        urlFonte: z.string().optional(),
        imagens: z.array(z.string()).optional(),
        documentoTipo: z.enum(["nenhum", "escritura", "contrato_gaveta", "inventario", "heranca", "financiado", "loteamento", "posse", "outros"]).optional(),
        documentoObs: z.string().optional(),
        contatoNome: z.string().optional(),
        contatoTel: z.string().optional(),
        notas: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        return db.createAgregadorImovel({
          ...input,
          preco: input.preco?.toString(),
          areaM2: input.areaM2?.toString(),
          imagens: JSON.stringify(input.imagens ?? []),
        } as any);
      }),

    updateStatus: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["pendente", "verificado", "arquivado"]),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, STAFF_ROLES);
        await db.updateAgregadorImovel(input.id, { status: input.status });
        return { success: true };
      }),

    importarParaCatalogo: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const imovel = await db.importarAgregadorParaCatalogo(input.id);
        if (!imovel) throw new TRPCError({ code: "NOT_FOUND" });
        return imovel;
      }),
  }),

  incorporacao: router({
    list: protectedProcedure
      .input(z.object({
        status: z.string().optional(),
      }).optional())
      .query(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.getAllIncorporationStudies(input);
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const estudo = await db.getIncorporationStudyById(input.id);
        if (!estudo) throw new TRPCError({ code: "NOT_FOUND" });
        return estudo;
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(2),
        city: z.string().min(1),
        state: z.string().length(2).optional(),
        address: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        responsible: z.string().optional(),
        propertyRef: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        return db.createIncorporationStudy({
          ...input,
          latitude: input.latitude?.toString(),
          longitude: input.longitude?.toString(),
        } as any);
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        city: z.string().optional(),
        state: z.string().length(2).optional(),
        address: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        responsible: z.string().optional(),
        status: z.enum(["draft", "in_study", "completed"]).optional(),
        propertyRef: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const { id, ...data } = input;
        await db.updateIncorporationStudy(id, {
          ...data,
          latitude: data.latitude?.toString(),
          longitude: data.longitude?.toString(),
        } as any);
        return { success: true };
      }),

    uploadKml: protectedProcedure
      .input(z.object({ id: z.number(), kmlContent: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const estudo = await db.getIncorporationStudyById(input.id);
        if (!estudo) throw new TRPCError({ code: "NOT_FOUND" });
        let terreno;
        try {
          terreno = parseKmlTerreno(input.kmlContent);
        } catch (e) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "KML inválido." });
        }
        await db.updateIncorporationStudy(input.id, {
          geojson: JSON.stringify(terreno.feature),
          areaM2: terreno.areaM2.toString(),
          perimeterM: terreno.perimetroM.toString(),
          latitude: terreno.centro[1].toString(),
          longitude: terreno.centro[0].toString(),
        });
        return {
          geojson: JSON.stringify(terreno.feature),
          areaM2: terreno.areaM2,
          perimetroM: terreno.perimetroM,
          centroLat: terreno.centro[1],
          centroLng: terreno.centro[0],
        };
      }),

    fetchElevation: protectedProcedure
      .input(z.object({
        id: z.number(),
        south: z.number(),
        north: z.number(),
        west: z.number(),
        east: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        const { id, ...bbox } = input;
        let grid;
        try {
          grid = await fetchElevationGrid(bbox);
        } catch (e) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: e instanceof Error ? e.message : "Falha ao obter elevação." });
        }
        await db.updateIncorporationStudy(id, { elevationJson: JSON.stringify(grid) });
        return grid;
      }),

    saveApp: protectedProcedure
      .input(z.object({
        id: z.number(),
        areaM2: z.number(),
        larguraM: z.number().nullable(),
        origem: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, {
          appAreaM2: input.areaM2.toString(),
          appWidthM: input.larguraM?.toString(),
          appOrigin: input.origem,
        });
        return { success: true };
      }),

    pesquisarMercado: protectedProcedure
      .input(z.object({ id: z.number(), municipio: z.string().min(1), estado: z.string().min(2) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        let resultado;
        try {
          resultado = await pesquisarMercado(input.municipio, input.estado);
        } catch (e) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: e instanceof Error ? e.message : "Falha na pesquisa de mercado." });
        }
        await db.updateIncorporationStudy(input.id, {
          cityResearchJson: JSON.stringify(resultado.cidade),
          marketStudyJson: JSON.stringify(resultado.mercado),
        });
        return resultado;
      }),

    savePrecificacao: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { comparablePricingJson: input.dataJson });
        return { success: true };
      }),

    savePesquisaPrimaria: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { primaryResearchJson: input.dataJson });
        return { success: true };
      }),

    saveUrbanismo: protectedProcedure
      .input(z.object({
        id: z.number(),
        parametrosJson: z.string().min(1),
        potencialJson: z.string().optional(),
        opiniao: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, {
          urbanParametersJson: input.parametrosJson,
          potentialJson: input.potencialJson,
          urbanisticOpinion: input.opiniao,
        });
        return { success: true };
      }),

    saveMassa: protectedProcedure
      .input(z.object({
        id: z.number(),
        dataJson: z.string().min(1),
        selectedScenarioId: z.string().nullable(),
      }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, {
          massScenariosJson: input.dataJson,
          selectedScenarioId: input.selectedScenarioId,
        });
        return { success: true };
      }),

    saveAreasBoard: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { areasBoardJson: input.dataJson });
        return { success: true };
      }),

    saveOrcamentoParametrizado: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { parameterizedBudgetJson: input.dataJson });
        return { success: true };
      }),

    saveNegociacaoTerreno: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { landNegotiationJson: input.dataJson });
        return { success: true };
      }),

    saveBusinessPlan: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { businessPlanJson: input.dataJson });
        return { success: true };
      }),

    saveProjetistas: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { designersJson: input.dataJson });
        return { success: true };
      }),

    saveAprovacaoProjeto: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { projectApprovalJson: input.dataJson });
        return { success: true };
      }),

    saveRegistroIncorporacao: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { incorporationRegistrationJson: input.dataJson });
        return { success: true };
      }),

    saveOrcamentoPreliminar: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { preliminaryBudgetJson: input.dataJson });
        return { success: true };
      }),

    savePlanejamentoLancamento: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { launchPlanJson: input.dataJson });
        return { success: true };
      }),

    saveFornecedoresLancamento: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { launchSuppliersJson: input.dataJson });
        return { success: true };
      }),

    saveMaterialPublicitario: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { marketingMaterialJson: input.dataJson });
        return { success: true };
      }),

    saveMixProdutos: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { productMixJson: input.dataJson });
        return { success: true };
      }),

    saveLancamentoImobiliario: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { realEstateLaunchJson: input.dataJson });
        return { success: true };
      }),

    saveProjetosExecutivos: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { executiveProjectsJson: input.dataJson });
        return { success: true };
      }),

    saveOrcamentoObra: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { workBudgetJson: input.dataJson });
        return { success: true };
      }),

    saveCronogramaObra: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { physicalFinancialScheduleJson: input.dataJson });
        return { success: true };
      }),

    saveAtendimentoClientes: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { customerServiceJson: input.dataJson });
        return { success: true };
      }),

    saveViabilidade: protectedProcedure
      .input(z.object({ id: z.number(), dataJson: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        requireRole(ctx, ["admin"]);
        await db.updateIncorporationStudy(input.id, { lottingJson: input.dataJson });
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
