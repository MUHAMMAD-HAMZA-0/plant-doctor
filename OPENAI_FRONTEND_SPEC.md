# OpenAI SDK Frontend-Only Spec (Expo)

## Goal
Expo frontend mein current direct Gemini REST flow ko `openai` standard SDK se replace karna, jahan possible ho to sirf `baseURL`, `apiKey`, aur `model` change karke same call-site pattern rakha ja sake.

## Current State (Observed)
- File: `app/components/ImagePickerScreen.tsx`
- AI calls abhi `callGeminiGenerate()` ke through direct endpoint hit kar rahi hain:
  - Plant validation (`processFile`)
  - Plant analysis (`analyzePlantGrowth`)
  - Suggestions (`getSuggestions`)
  - Chat (`handleSendChat`)
- Env vars:
  - `EXPO_PUBLIC_GEMINI_API_KEY`
  - `EXPO_PUBLIC_GEMINI_VISION_MODEL`
  - `EXPO_PUBLIC_GEMINI_TEXT_MODEL`

## Key Feasibility Answer
`Sirf baseURL + apiKey + model` tab feasible hai jab provider OpenAI-compatible API expose karta ho.

- OpenAI native API: feasible
- OpenRouter / Together / Groq (OpenAI-compatible mode): feasible
- Gemini native `generativelanguage.googleapis.com` endpoint: **not** drop-in feasible with OpenAI SDK only by baseURL swap, kyun ke request/response schema different hai (`contents/parts` vs `messages`, `candidates` vs `choices`).

## Frontend-Only Security Reality
Expo frontend mein `EXPO_PUBLIC_*` keys app bundle mein exposed hoti hain. Is liye:
- Production mein long-lived secret key frontend mein rakhna unsafe hai.
- Agar frontend-only rakhna hai to restricted/ephemeral key strategy chahiye (provider support dependent).
- Best practice still: thin backend token broker/proxy.

## Proposed Architecture (Frontend Scope)
Ek provider-agnostic client wrapper banayein:

- New file: `app/lib/aiClient.ts`
- Central config:
  - `EXPO_PUBLIC_AI_PROVIDER` (`openai` | `openai_compatible` | `gemini_native`)
  - `EXPO_PUBLIC_AI_BASE_URL`
  - `EXPO_PUBLIC_AI_API_KEY`
  - `EXPO_PUBLIC_AI_VISION_MODEL`
  - `EXPO_PUBLIC_AI_TEXT_MODEL`
- Public methods:
  - `validatePlantFromImage(base64)`
  - `analyzePlantFromImage(base64)`
  - `suggestFromImageAndReport(base64, reportJson)`
  - `chatAboutReport(history, reportJson, userQuestion)`

`ImagePickerScreen.tsx` sirf wrapper methods call kare; provider-specific payload logic wrapper mein rahe.

## SDK Choice
Install:
- `npm i openai`

Use:
- `chat.completions.create(...)` for text + image input
- JSON shape enforcement via prompt + optional response format where supported

## Migration Plan
1. Add `openai` dependency.
2. Create `app/lib/aiClient.ts` with OpenAI client init:
   - `new OpenAI({ apiKey, baseURL })`
3. Port existing 4 Gemini use-cases to OpenAI message format.
4. Replace direct `callGeminiGenerate` usages in `ImagePickerScreen.tsx` with wrapper calls.
5. Keep compatibility fallback:
   - If provider is `gemini_native`, use existing Gemini fetch path (separate adapter).
6. Update `.env` names to provider-agnostic keys.

## Example Shape (OpenAI-Compatible)
```ts
const response = await client.chat.completions.create({
  model: visionModel,
  temperature: 0.2,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Return ONLY raw JSON ..." },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } }
      ]
    }
  ]
});

const text = response.choices?.[0]?.message?.content ?? "";
```

## Risks / Gotchas
- React Native runtime compatibility:
  - `openai` SDK usually fetch-based hai; Expo SDK 54 pe generally workable, lekin production build test لازمی.
- Token/cost spikes:
  - Image + chat multi-turn calls expensive ho sakti hain.
- JSON compliance:
  - Model kabhi strict JSON break kar sakta hai; existing `parseJsonText` fallback rakhna useful hai.
- Rate limits:
  - Frontend direct keys hone par abuse risk high.

## Minimum Acceptance Criteria
- `ImagePickerScreen.tsx` mein koi direct Gemini endpoint call na rahe (except optional gemini adapter fallback).
- 4 existing user flows unchanged behavior ke sath kaam karein:
  - Validate
  - Analyze
  - Suggestions
  - Chat
- Model switch only env se ho.
- Clear runtime error agar key/baseURL/model missing ho.

## Recommendation
Frontend-only temporary setup theek hai for dev/testing. Production ke liye:
1. Short-lived token issuing endpoint add karein, ya
2. At minimum provider-side strict key restrictions enforce karein.
