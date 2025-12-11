/**
 * NEAR AI verification module
 *
 * ```ts
 * import { verifyChat, fetchAttestation, extractSigningAddresses } from "@/lib/verification";
 *
 * const model = "deepseek-ai/DeepSeek-V3.1";
 * const apiKey = process.env.NEAR_AI_CLOUD_API_KEY!;
 *
 * const attestation = await fetchAttestation(model, apiKey);
 * const teeAddresses = extractSigningAddresses(attestation);
 *
 * const requestBody = JSON.stringify({
 *   messages: [{ role: "user", content: "Hello" }],
 *   model,
 *   stream: true,
 * });
 *
 * const result = await verifyChat({
 *   requestBody,
 *   model,
 *   apiKey,
 *   teeAddresses,
 * });
 *
 * if (result.verified) {
 *   console.log("✅ Verified!");
 * }
 * ```
 */

export * from "./types";
export * from "./verify";
