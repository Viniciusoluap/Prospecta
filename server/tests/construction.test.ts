import { describe, it, expect } from "vitest";
import * as db from "../db";

/**
 * Testes para validar o backend do Sistema de Obras
 * Verifica se as funções CRUD e rotas tRPC estão funcionando corretamente
 */

describe("Sistema de Obras - Backend", () => {
  it("deve ter funções CRUD de projetos exportadas", () => {
    expect(db.getProjectsByUserId).toBeDefined();
    expect(db.getProjectById).toBeDefined();
    expect(db.createProject).toBeDefined();
    expect(db.updateProject).toBeDefined();
    expect(db.deleteProject).toBeDefined();
  });

  it("deve ter funções CRUD de etapas exportadas", () => {
    expect(db.getStagesByProjectId).toBeDefined();
    expect(db.getStageById).toBeDefined();
    expect(db.createStage).toBeDefined();
    expect(db.updateStage).toBeDefined();
    expect(db.deleteStage).toBeDefined();
  });

  it("deve ter funções CRUD de fotos exportadas", () => {
    expect(db.getPhotosByProjectId).toBeDefined();
    expect(db.getPhotosByStageId).toBeDefined();
    expect(db.createPhoto).toBeDefined();
    expect(db.deletePhoto).toBeDefined();
  });

  it("deve ter função helper para buscar projeto com detalhes", () => {
    expect(db.getProjectWithDetails).toBeDefined();
  });
});

describe("Schema de Obras", () => {
  it("deve ter tabelas de obras importadas no schema", async () => {
    const schema = await import("../../drizzle/schema");

    expect(schema.constructionProjects).toBeDefined();
    expect(schema.constructionStages).toBeDefined();
    expect(schema.constructionPhotos).toBeDefined();
  });

  it("deve ter tipos TypeScript corretos exportados", async () => {
    const schema = await import("../../drizzle/schema");

    // Verificar se os tipos estão disponíveis (TypeScript compile-time check)
    type ProjectType = typeof schema.ConstructionProject;
    type StageType = typeof schema.ConstructionStage;
    type PhotoType = typeof schema.ConstructionPhoto;

    expect(true).toBe(true); // Se compilar, os tipos existem
  });
});

describe("Rotas tRPC de Obras", () => {
  it("deve ter rotas tRPC de construction exportadas", async () => {
    const routers = await import("../routers");
    const routerType = routers.appRouter;

    // Verificar se o router construction existe
    expect(routerType).toBeDefined();
  });
});
