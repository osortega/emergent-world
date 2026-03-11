// LLM caller using GitHub Models API
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const API_URL = 'https://models.github.ai/inference/chat/completions';
const MODEL = 'openai/gpt-4o-mini';

export async function callLLM(systemPrompt, userPrompt, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.9,
          max_tokens: 800,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`LLM API error (attempt ${attempt + 1}): ${res.status} ${err}`);
        if (attempt < retries) continue;
        return null;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) return null;

      // Try to parse JSON from response
      try {
        // Find JSON in the response (might be wrapped in markdown code blocks)
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return { parsed: JSON.parse(jsonMatch[0]), raw: content };
        }
      } catch (e) {
        // JSON parse failed
      }

      // Return raw content with default action
      return {
        parsed: {
          thinking: content,
          action_description: 'stands still, confused',
          action_type: 'nothing',
          action_details: {},
          memory_update: 'I felt confused and did nothing.'
        },
        raw: content,
      };
    } catch (err) {
      console.error(`LLM call failed (attempt ${attempt + 1}):`, err.message);
      if (attempt < retries) continue;
      return null;
    }
  }
  return null;
}
