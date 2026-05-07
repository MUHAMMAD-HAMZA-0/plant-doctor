# OpenAI SDK — Enterprise Integration Spec

## Architecture

```
.env  ──► openaiService.ts  ──► PlantScannerScreen.tsx
(config)     (enterprise client)     (UI integration)
```

---

## .env Variables (single source of truth)

```env
EXPO_PUBLIC_OPENAI_API_KEY=sk-your-key-here
EXPO_PUBLIC_OPENAI_VISION_MODEL=gpt-4.1          # model yahan change karo
EXPO_PUBLIC_OPENAI_MAX_TOKENS=1024
EXPO_PUBLIC_OPENAI_TIMEOUT_MS=30000
EXPO_PUBLIC_OPENAI_MAX_RETRIES=3
```

Model change karna ho to **sirf `.env`** mein `EXPO_PUBLIC_OPENAI_VISION_MODEL` update karo —
code mein kuch nahi badalna.

---

## Service File: [`services/openaiService.ts`](../services/openaiService.ts)

### Enterprise Features

| Feature | Implementation |
|---|---|
| .env-driven config | Sab values `process.env.EXPO_PUBLIC_*` se |
| Retry logic | OpenAI SDK built-in `maxRetries` |
| Timeout | SDK-level `timeout` (ms) |
| Deterministic output | `temperature: 0` |
| High-quality vision | `detail: 'high'` |
| Structured error types | `OpenAIServiceError` discriminated union |
| Response validation | Strict schema check after parse |
| Missing key guard | Early throw with clear message |

### Error Codes

```ts
type OpenAIServiceError =
  | { code: 'MISSING_KEY' }        // .env mein key nahi
  | { code: 'INVALID_IMAGE' }      // file read fail
  | { code: 'PARSE_ERROR' }        // model ne JSON nahi diya
  | { code: 'RATE_LIMITED' }       // 429 — retry-after bhi milega
  | { code: 'QUOTA_EXCEEDED' }     // 402/403
  | { code: 'TIMEOUT' }            // timeout hit
  | { code: 'API_ERROR' }          // other HTTP errors
  | { code: 'NETWORK_ERROR' }      // no connection
```

---

## PlantScannerScreen Usage

```ts
import { analyzePlantImage, PlantAnalysisError } from '@/services/openaiService';

async function analyzeWithOpenAI() {
  try {
    const result = await analyzePlantImage(selectedImage.uri, selectedImage.type);
    // result: { status, diseaseName, details, remedy }
  } catch (error) {
    if (error instanceof PlantAnalysisError) {
      switch (error.serviceError.code) {
        case 'RATE_LIMITED':
          // retry after error.serviceError.retryAfter seconds
          break;
        case 'QUOTA_EXCEEDED':
          // show billing message
          break;
        default:
          // show error.message to user
      }
    }
  }
}
```

---

## Installed Packages

```
openai                    — official OpenAI SDK
react-native-url-polyfill — SDK ko React Native mein chalane ke liye
expo-file-system          — image URI → base64 conversion
```

---

## Models Reference

| Model | Best For | Vision |
|---|---|---|
| `gpt-4.1` | Latest, enterprise-grade | ✓ |
| `gpt-4o` | Fast + capable | ✓ |
| `gpt-4o-mini` | Low cost | ✓ |

Default: `gpt-4.1` — `.env` se override karo.
