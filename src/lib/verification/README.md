# NEAR AI Verification

This module provides a clean, straightforward implementation of NEAR AI Cloud verification.

## Verification Flow

1. **Send Request**: Send chat completion request to NEAR AI Cloud
2. **Compute Hashes**: SHA-256 hash of exact request body and response text
3. **Fetch Signature**: Get signature from `/v1/signature/{chatId}`
4. **Validate Hashes**: Signature text is `"{requestHash}:{responseHash}"`
5. **Verify Signature**: ECDSA signature must recover to a known TEE address

## Usage

### Send + Verify

```ts
import {
  verifyChat,
  fetchAttestation,
  extractSigningAddresses,
} from "@/lib/verification";

const model = "deepseek-ai/DeepSeek-V3.1";
const apiKey = process.env.NEAR_AI_CLOUD_API_KEY!;

const attestation = await fetchAttestation(model, apiKey);
const teeAddresses = extractSigningAddresses(attestation);

const requestBody = JSON.stringify({
  messages: [{ role: "user", content: "Hello" }],
  model,
  stream: true,
});

const result = await verifyChat({
  requestBody,
  model,
  apiKey,
  teeAddresses,
});

console.log("Verified:", result.verified);
console.log("Hash match:", result.hashValidation?.valid);
console.log("Signature valid:", result.signatureValidation?.valid);
```

### Verify Existing Response

```ts
import { verifyExistingResponse } from "@/lib/verification";

const result = await verifyExistingResponse({
  requestBody, // Exact JSON string sent
  responseText, // Exact response text received
  chatId, // From response
  model,
  apiKey,
  teeAddresses,
});
```

### Individual Functions

```ts
import { sha256, compareHashes, verifySignature } from "@/lib/verification";

const hash = sha256(data);
const hashResult = compareHashes(signatureText, requestHash, responseHash);
const sigResult = verifySignature(message, signature, expectedAddresses);
```
