// LLM caller — supports GitHub Models + GitHub Copilot APIs
import { readFileSync } from 'fs';
import { join } from 'path';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// GitHub Models API
const MODELS_URL = 'https://models.github.ai/inference/chat/completions';

// GitHub Copilot API
const COPILOT_URL = 'https://api.githubcopilot.com/chat/completions';
const COPILOT_TOKEN_PATH = join(process.env.HOME, '.openclaw/credentials/github-copilot.token.json');

function getCopilotToken() {
  try {
    const data = JSON.parse(readFileSync(COPILOT_TOKEN_PATH, 'utf-8'));
    if (data.expiresAt && Date.now() > data.expiresAt) {
      console.error('Copilot token expired');
      return null;
    }
    return data.token;
  } catch (e) {
    console.error('Could not read Copilot token:', e.message);
    return null;
  }
}

// Available models
export const MODELS = {
  'gpt-4o-mini':    { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', short: '4o-m', api: 'models' },
  'gpt-4o':         { id: 'openai/gpt-4o', label: 'GPT-4o', short: '4o', api: 'models' },
  'deepseek':       { id: 'deepseek/DeepSeek-V3-0324', label: 'DeepSeek V3', short: 'ds', api: 'models' },
  'o4-mini':        { id: 'openai/o4-mini', label: 'o4-mini', short: 'o4m', api: 'models', useCompletionTokens: true },
  'claude-opus':    { id: 'claude-opus-4.6', label: 'Claude Opus 4.6', short: 'opus', api: 'copilot' },
  'claude-sonnet':  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', short: 'son', api: 'copilot' },
};

const DEFAULT_MODEL = 'gpt-4o-mini';

export function getModelConfig(modelKey) {
  return MODELS[modelKey] || MODELS[DEFAULT_MODEL];
}

export async function callLLM(systemPrompt, userPrompt, modelKey, retries = 2) {
  const model = getModelConfig(modelKey);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let url, headers, body;

      if (model.api === 'copilot') {
        const token = getCopilotToken();
        if (!token) {
          console.error(`No Copilot token available for ${model.label}`);
          return null;
        }
        url = COPILOT_URL;
        headers = {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Copilot-Integration-Id': 'vscode-chat',
        };
      } else {
        url = MODELS_URL;
        headers = {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
        };
      }

      body = {
        model: model.id,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.9,
      };

      if (model.useCompletionTokens) {
        body.max_completion_tokens = 800;
      } else {
        body.max_tokens = 800;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
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

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return { parsed: JSON.parse(jsonMatch[0]), raw: content, model: model.label };
        }
      } catch (e) {}

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
