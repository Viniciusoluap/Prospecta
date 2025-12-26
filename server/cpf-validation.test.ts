import { describe, it, expect } from "vitest";
import { validateCPF, isValidCPF, cleanCPF, formatCPF } from "../shared/cpf";

describe("CPF Validation", () => {
  describe("cleanCPF", () => {
    it("should remove non-numeric characters", () => {
      expect(cleanCPF("123.456.789-09")).toBe("12345678909");
      expect(cleanCPF("000.000.000-00")).toBe("00000000000");
      expect(cleanCPF("12345678909")).toBe("12345678909");
    });
  });

  describe("formatCPF", () => {
    it("should format CPF correctly", () => {
      expect(formatCPF("12345678909")).toBe("123.456.789-09");
      expect(formatCPF("123")).toBe("123");
      expect(formatCPF("123456")).toBe("123.456");
      expect(formatCPF("123456789")).toBe("123.456.789");
    });
  });

  describe("validateCPF", () => {
    it("should validate correct CPFs", () => {
      // CPFs válidos conhecidos
      expect(validateCPF("529.982.247-25").valid).toBe(true);
      expect(validateCPF("52998224725").valid).toBe(true);
      expect(validateCPF("111.444.777-35").valid).toBe(true);
      expect(validateCPF("11144477735").valid).toBe(true);
    });

    it("should reject CPFs with wrong length", () => {
      expect(validateCPF("123").valid).toBe(false);
      expect(validateCPF("123456789").valid).toBe(false);
      expect(validateCPF("123456789012").valid).toBe(false);
    });

    it("should reject repeated sequence CPFs", () => {
      expect(validateCPF("000.000.000-00").valid).toBe(false);
      expect(validateCPF("111.111.111-11").valid).toBe(false);
      expect(validateCPF("222.222.222-22").valid).toBe(false);
      expect(validateCPF("333.333.333-33").valid).toBe(false);
      expect(validateCPF("444.444.444-44").valid).toBe(false);
      expect(validateCPF("555.555.555-55").valid).toBe(false);
      expect(validateCPF("666.666.666-66").valid).toBe(false);
      expect(validateCPF("777.777.777-77").valid).toBe(false);
      expect(validateCPF("888.888.888-88").valid).toBe(false);
      expect(validateCPF("999.999.999-99").valid).toBe(false);
    });

    it("should reject CPFs with invalid check digits", () => {
      // CPF com primeiro dígito verificador errado
      expect(validateCPF("529.982.247-35").valid).toBe(false);
      // CPF com segundo dígito verificador errado
      expect(validateCPF("529.982.247-26").valid).toBe(false);
      // CPF completamente inválido
      expect(validateCPF("123.456.789-00").valid).toBe(false);
    });

    it("should return appropriate messages", () => {
      expect(validateCPF("123").message).toBe("CPF deve ter 11 dígitos");
      expect(validateCPF("111.111.111-11").message).toBe("CPF inválido (sequência repetida)");
      expect(validateCPF("529.982.247-25").message).toBe("CPF válido");
    });
  });

  describe("isValidCPF", () => {
    it("should return boolean for valid CPFs", () => {
      expect(isValidCPF("529.982.247-25")).toBe(true);
      expect(isValidCPF("111.444.777-35")).toBe(true);
    });

    it("should return boolean for invalid CPFs", () => {
      expect(isValidCPF("123.456.789-00")).toBe(false);
      expect(isValidCPF("111.111.111-11")).toBe(false);
    });
  });
});
