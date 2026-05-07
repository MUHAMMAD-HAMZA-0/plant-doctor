import json

import httpx

from app.core.config import get_settings


class GeminiLeafAnalyzer:
    """Analyze individual leaf crops using DeepSeek vision API."""

    def __init__(self) -> None:
        self.settings = get_settings()

    async def analyze_leaf(self, image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
        api_key = self.settings.deepseek_api_key.strip()
        if not api_key:
            raise ValueError("DEEPSEEK_API_KEY is not configured.")

        import base64
        b64_image = base64.b64encode(image_bytes).decode("utf-8")
        data_url = f"data:{mime_type};base64,{b64_image}"

        payload = {
            "model": self.settings.deepseek_vision_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                        {
                            "type": "text",
                            "text": (
                                "Analyze this single cropped plant leaf. "
                                "Return ONLY valid raw JSON with this exact shape: "
                                '{"condition":"healthy | yellowing | brown_spots | wilting | pest_damage | fungal_suspected | unknown",'
                                '"severity":"none | mild | moderate | severe",'
                                '"confidence":0.0,'
                                '"observations":["short note"],'
                                '"recommendation":"short action"}'
                            ),
                        },
                    ],
                }
            ],
            "temperature": 0.2,
            "max_tokens": 300,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.deepseek.com/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        text = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
        if not text:
            raise ValueError("DeepSeek returned an empty response.")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start = text.find("{")
            end = text.rfind("}")
            if start >= 0 and end > start:
                return json.loads(text[start : end + 1])
            raise
