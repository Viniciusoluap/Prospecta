/**
 * Image generation helper using internal ImageService
 *
 * Example usage:
 *   const { url: imageUrl } = await generateImage({
 *     prompt: "A serene landscape with mountains"
 *   });
 *
 * For editing:
 *   const { url: imageUrl } = await generateImage({
 *     prompt: "Add a rainbow to this landscape",
 *     originalImages: [{
 *       url: "https://example.com/original.jpg",
 *       mimeType: "image/jpeg"
 *     }]
 *   });
 */
import { storagePut } from "../storage.js";
import { ENV } from "./env.js";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageResponse = {
  url?: string;
};

/**
 * EPIC-024 S-02: o que falta para gerar imagem (Manus Forge). Lista vazia = configurado.
 * Nenhum outro provedor é usado para imagem (Anthropic e Gemini ficam de fora).
 */
export function faltandoParaGerarImagem(): string[] {
  return [
    ...(ENV.forgeApiUrl ? [] : ["BUILT_IN_FORGE_API_URL"]),
    ...(ENV.forgeApiKey ? [] : ["BUILT_IN_FORGE_API_KEY"]),
  ];
}

/** Gera a imagem e devolve os bytes, sem gravar no S3 (o logotipo do estudo fica no banco). */
export async function generateImageBytes(
  options: GenerateImageOptions
): Promise<{ data: Buffer; mimeType: string }> {
  const faltando = faltandoParaGerarImagem();
  if (faltando.length) throw new Error(`${faltando.join(" e ")} não configurado`);
  return requestImage(options);
}

export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  if (!ENV.forgeApiUrl) {
    throw new Error("BUILT_IN_FORGE_API_URL is not configured");
  }
  if (!ENV.forgeApiKey) {
    throw new Error("BUILT_IN_FORGE_API_KEY is not configured");
  }

  const image = await requestImage(options);

  // Save to S3
  const { url } = await storagePut(
    `generated/${Date.now()}.png`,
    image.data,
    image.mimeType
  );
  return {
    url,
  };
}

async function requestImage(
  options: GenerateImageOptions
): Promise<{ data: Buffer; mimeType: string }> {
  // Build the full URL by appending the service path to the base URL
  const baseUrl = ENV.forgeApiUrl.endsWith("/")
    ? ENV.forgeApiUrl
    : `${ENV.forgeApiUrl}/`;
  const fullUrl = new URL(
    "images.v1.ImageService/GenerateImage",
    baseUrl
  ).toString();

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "connect-protocol-version": "1",
      authorization: `Bearer ${ENV.forgeApiKey}`,
    },
    body: JSON.stringify({
      prompt: options.prompt,
      original_images: options.originalImages || [],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Image generation request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }

  const result = (await response.json()) as {
    image: {
      b64Json: string;
      mimeType: string;
    };
  };
  const base64Data = result.image.b64Json;
  return { data: Buffer.from(base64Data, "base64"), mimeType: result.image.mimeType };
}
