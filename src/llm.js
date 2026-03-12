// LLM caller — supports multiple providers via GitHub Models API
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const API_URL = 'https://models.github.ai/inference/chat/completions';

// Available models — assign per citizen
export const MODELS = {
  'gpt-4o-mini': { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', short: '4o-m' },
  'gpt-4o': { id: 'openai/gpt-4o', label: 'GPT-4o', short: '4o' },
  'claude-sonnet': { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet', short: 'son' },
  'deepseek': { id: 'deepseek/DeepSeek-V3-0324', label: 'DeepSeek V3', short: 'ds' },
};

const DEFAULT_MODEL = 'gpt-4o-mini';

export function getModelConfig(modelKey) {
  return MODELS[modelKey] || MODELS[DEFAULT_MODEL];
}

export async function callLLM(systemPrompt, userPrompt, modelKey, retries = 2) {
  const model = getModelConfig(modelKey);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model.id,
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
        console.error(`LLM API error [${model.label}] (attempt ${attempt + 1}): ${res.status} ${err}`);
        if (attempt < retries) continue;
        return null;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) return null;

      // Try to parse JSON from response
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return { parsed: JSON.parse(jsonMatch[0]), raw: content, model: model.label };
        }
      } catch (e) {
        // JSON parse failed
      }

      return {
        parsed: {
          thinking: content,
          action_description: 'stands still, confused',
          action_type: 'nothing',
          action_details: {},
          memory_update: 'I felt confused and did nothing.'
        },
        raw: content,
        model: model.label,
      };
    } catch (err) {
      console.error(`LLM call failed [${model.label}] (attempt ${attempt + 1}):`, err.message);
      if (attempt < retries) continue;
      return null;
    }
  }
  return null;
}
