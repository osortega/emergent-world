// Tick engine — runs one simulation tick with LLM-powered citizen decisions
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { callLLM, getModelConfig } from './llm.js';

const WORLD_DIR = join(process.cwd(), 'world');

const SEASONS = ['spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter'];
const SEASON_FOOD_MULT = { spring: 1.0, summer: 1.5, autumn: 1.0, winter: 0.0 };
const EDIBLE = ['grain', 'fish', 'herbs', 'fresh_water', 'crops'];

// ─── Name generator for offspring ──────────────────────────────────────
const NAME_PARTS_START = ['A','Ba','Be','Bri','Ca','Da','De','E','Fa','Fe','Ga','Ha','I','Ja','Ka','Ki','La','Le','Li','Ma','Mi','Na','Ne','No','O','Pa','Ra','Re','Ri','Sa','Se','Si','Ta','Te','Th','Ti','Va','Ve','Vi','Za','Ze','Zu'];
const NAME_PARTS_END = ['ra','na','el','is','an','en','or','al','on','ar','ik','ak','ell','yn','os','as','ir','ur','im','ax','id','ek','ol','un','iss','enn','ara','ira'];

function generateName(existingNames) {
  for (let i = 0; i < 50; i++) {
    const start = NAME_PARTS_START[Math.floor(Math.random() * NAME_PARTS_START.length)];
    const end = NAME_PARTS_END[Math.floor(Math.random() * NAME_PARTS_END.length)];
    const name = start + end;
    if (!existingNames.includes(name.toLowerCase()) && name.length >= 3 && name.length <= 7) {
      return name;
    }
  }
  return 'Child' + Math.floor(Math.random() * 999);
}

// ─── Physical description blending ─────────────────────────────────────
const BODY_TYPES = ['Tall and lean', 'Short and compact', 'Wiry and quick', 'Broad and sturdy', 'Small and nimble', 'Lanky and angular', 'Slight and delicate', 'Stocky and strong'];
const FEATURES = ['bright curious eyes', 'a calm steady gaze', 'sharp watchful eyes', 'wide trusting eyes', 'a furrowed brow', 'quick darting eyes', 'deep set thoughtful eyes', 'large expressive eyes'];
const DETAILS = ['with long deft fingers', 'and calloused hands', 'with dirt under every nail', 'and tangled hair', 'with sun-darkened skin', 'and a cautious posture', 'with restless hands', 'and scarred knees'];

function generateDescription() {
  const body = BODY_TYPES[Math.floor(Math.random() * BODY_TYPES.length)];
  const feature = FEATURES[Math.floor(Math.random() * FEATURES.length)];
  const detail = DETAILS[Math.floor(Math.random() * DETAILS.length)];
  return `${body} with ${feature} ${detail}`;
}

function blendSkill(a, b) {
  const base = Math.round((a + b) / 2);
  const mutation = Math.random() < 0.3 ? (Math.random() < 0.5 ? 1 : -1) : 0;
  return Math.max(1, Math.min(5, base + mutation));
}

function spawnOffspring(parentA, parentB, region) {
  const existingNames = readdirSync(join(WORLD_DIR, 'citizens')).map(f => f.replace('.json', ''));
  const name = generateName(existingNames);
  const id = name.toLowerCase();

  const child = {
    id,
    name,
    physical_description: generateDescription(),
    skills: {
      strength: blendSkill(parentA.skills.strength, parentB.skills.strength),
      dexterity: blendSkill(parentA.skills.dexterity, parentB.skills.dexterity),
      perception: blendSkill(parentA.skills.perception, parentB.skills.perception),
      endurance: blendSkill(parentA.skills.endurance, parentB.skills.endurance),
      social: blendSkill(parentA.skills.social, parentB.skills.social),
      curiosity: blendSkill(parentA.skills.curiosity, parentB.skills.curiosity),
    },
    inventory: {},
    memory: [],
    health: 5,
    max_health: 10,
    food: 1,
    region: parentA.region,
    has_shelter: false,
    relationships: {},
    encounters: {},
    alive: true,
    born_tick: parseInt(readJSON(join(WORLD_DIR, 'clock.json')).tick) || 0,
    model: 'claude-opus',
    _starveTicks: 0,
    _lastOutcome: null,
    _parents: [parentA.id, parentB.id],
  };

  // Add to region
  if (region.citizens) region.citizens.push(id);

  return child;
}

function readJSON(path) { return JSON.parse(readFileSync(path, 'utf-8')); }
function writeJSON(path, data) { writeFileSync(path, JSON.stringify(data, null, 2)); }

// ─── Region discovery / procedural generation ─────────────────────────
const REGION_TEMPLATES = [
  {
    terrain: 'plains', name: 'Grasslands',
    description: 'Wide open fields of tall grass stretching in every direction. The wind creates waves across the golden stalks. Small rodents dart between the roots.',
    features: { grain: { amount: 25, description: 'Wild grain and seed heads swaying in the wind' }, herbs: { amount: 15, description: 'Low shrubs and medicinal plants' } }
  },
  {
    terrain: 'cave', name: 'Dark Caverns',
    description: 'A yawning cave mouth opens into darkness. Dripping water echoes from within. Strange minerals glint on the walls. The air is cool and still.',
    features: { stone: { amount: 35, description: 'Mineral deposits and loose rock formations' }, fresh_water: { amount: 20, description: 'Underground spring feeding a clear pool' } }
  },
  {
    terrain: 'jungle', name: 'Dense Jungle',
    description: 'Thick vegetation blocks the sky. Massive trees with tangled roots tower overhead. Strange fruits hang from vines. Insects hum in the humid air.',
    features: { herbs: { amount: 30, description: 'Exotic plants and fruits hanging from vines' }, wood: { amount: 25, description: 'Fallen branches and thick bamboo stalks' } }
  },
  {
    terrain: 'tundra', name: 'Frozen Tundra',
    description: 'Flat, treeless expanse covered in frost and low scrub. The cold bites deep. Patches of ice reflect pale light. Hardy lichens cling to scattered boulders.',
    features: { stone: { amount: 20, description: 'Frost-cracked boulders and gravel' }, herbs: { amount: 8, description: 'Tough lichens and frozen berries' } }
  },
  {
    terrain: 'oasis', name: 'Hidden Oasis',
    description: 'A lush green patch surrounding a clear spring. Palm-like trees provide shade. Colorful birds drink at the water edge. Fish dart in the pool.',
    features: { fresh_water: { amount: 30, description: 'Crystal-clear spring water' }, fish: { amount: 20, description: 'Small colorful fish in the pool' }, herbs: { amount: 15, description: 'Fruit-bearing plants and soft grasses' } }
  },
  {
    terrain: 'cliffs', name: 'Coastal Cliffs',
    description: 'Sheer rock faces drop into churning water far below. Nests line the cliff ledges. Strong winds whip across the exposed stone. The view stretches endlessly.',
    features: { stone: { amount: 20, description: 'Loose shale and flint along the cliff tops' }, fish: { amount: 15, description: 'Tidal pools trapped in rock shelves below' } }
  },
  {
    terrain: 'swamp', name: 'Murky Swamp',
    description: 'Stagnant water covers the ground between gnarled trees. Thick moss hangs from every branch. Bubbles rise from the dark water. Frogs croak in unison.',
    features: { wood: { amount: 20, description: 'Rotting logs and flexible green branches' }, herbs: { amount: 20, description: 'Moss, mushrooms, and strange tubers in the mud' } }
  },
  {
    terrain: 'volcanic', name: 'Scorched Lands',
    description: 'Dark rock stretches across a landscape scarred by ancient fire. Steam vents hiss between cracks. The ground is warm underfoot. Obsidian shards litter the surface.',
    features: { stone: { amount: 40, description: 'Obsidian shards and volcanic glass' }, fresh_water: { amount: 5, description: 'Hot spring with mineral-rich water' } }
  },
];

const REGION_ADJECTIVES = ['Ancient', 'Whispering', 'Silent', 'Sunlit', 'Shadowed', 'Windswept', 'Misty', 'Forgotten', 'Verdant', 'Barren', 'Crystal', 'Iron', 'Amber', 'Twilight'];

function generateNewRegion(sourceRegion, existingRegions) {
  const existingCount = Object.keys(existingRegions).length;
  if (existingCount >= 20) return null; // cap at 20 regions

  // Pick a template that hasn't been used much
  const usedTerrains = Object.values(existingRegions).map(r => r.terrain);
  let available = REGION_TEMPLATES.filter(t => usedTerrains.filter(u => u === t.terrain).length < 2);
  if (available.length === 0) available = REGION_TEMPLATES;
  const template = available[Math.floor(Math.random() * available.length)];

  // Generate unique name
  const adj = REGION_ADJECTIVES[Math.floor(Math.random() * REGION_ADJECTIVES.length)];
  const name = `${adj} ${template.name}`;
  const id = name.toLowerCase().replace(/\s+/g, '-');

  // Don't create if ID already exists
  if (existingRegions[id]) return null;

  // Deep copy features with some randomization
  const features = {};
  for (const [k, v] of Object.entries(template.features)) {
    features[k] = {
      amount: Math.floor(v.amount * (0.6 + Math.random() * 0.8)),
      description: v.description,
    };
  }

  return {
    id,
    name,
    terrain: template.terrain,
    description: template.description,
    features,
    adjacent: [],
    weather: 'clear',
    recent_events: [],
    citizens: [],
    discovered_by: null,
    discovered_tick: null,
  };
}

// ─── Describe citizen body/state ──────────────────────────────────────

function describeSkills(skills) {
  const descs = [];
  if (skills.strength >= 4) descs.push('You are very strong — your body is powerful.');
  else if (skills.strength >= 3) descs.push('You are fairly strong.');
  else if (skills.strength <= 1) descs.push('You are not very strong physically.');
  if (skills.dexterity >= 4) descs.push('Your hands are extremely nimble and precise.');
  else if (skills.dexterity >= 3) descs.push('Your hands are quick and steady.');
  else if (skills.dexterity <= 1) descs.push('Your movements are somewhat clumsy.');
  if (skills.perception >= 4) descs.push('Your senses are incredibly sharp — you notice everything.');
  else if (skills.perception >= 3) descs.push('You are quite observant.');
  else if (skills.perception <= 1) descs.push('You tend to miss subtle details.');
  if (skills.endurance >= 4) descs.push('You can endure great hardship — cold, pain, hunger affect you less.');
  else if (skills.endurance >= 3) descs.push('You are resilient and tough.');
  else if (skills.endurance <= 1) descs.push('You tire easily and are sensitive to discomfort.');
  if (skills.social >= 3) descs.push('You feel drawn to other beings — their presence comforts you.');
  else if (skills.social <= 1) descs.push('Other beings make you uneasy.');
  if (skills.curiosity >= 4) descs.push('Everything fascinates you — you feel compelled to explore and examine.');
  else if (skills.curiosity >= 3) descs.push('You are naturally curious about your surroundings.');
  else if (skills.curiosity <= 1) descs.push('You prefer the familiar over the unknown.');
  return descs.join(' ');
}

function describeInventory(inv) {
  const items = Object.entries(inv).filter(([, v]) => v > 0);
  if (items.length === 0) return 'You are carrying nothing. Your hands are empty.';
  const names = {
    wood: 'pieces of wood', stone: 'stones', grain: 'handfuls of seeds/grain',
    fish: 'fish', herbs: 'bundles of plants', fresh_water: 'containers of water',
    hide: 'animal skins', iron_ore: 'chunks of glinting rock', crops: 'harvested food from planted crops',
    stone_tool: 'a sharp stone bound to wood — it fits in your hand',
    fishing_spear: 'a long pointed stick — good for stabbing',
  };
  const descs = items.map(([item, count]) => `${count} ${names[item] || item}`);
  return `You are carrying: ${descs.join(', ')}.`;
}

function describeHealth(citizen) {
  const parts = [];
  if (citizen.health <= 2) parts.push('Your body is shutting down. Every movement is agony. You can barely stay conscious. You are dying.');
  else if (citizen.health <= 4) parts.push('You feel weak and in pain. Your limbs tremble. Something is very wrong with your body.');
  else if (citizen.health <= 6) parts.push('You feel hurt and sore. Your body aches and you feel drained.');
  else if (citizen.health <= 8) parts.push('You feel mostly fine, with minor aches.');
  else parts.push('You feel healthy and strong.');
  const ticksWithoutFood = citizen._starveTicks || 0;
  if (citizen.food <= 0 && ticksWithoutFood >= 6) {
    parts.push('YOU ARE STARVING. Your vision blurs. Your hands shake uncontrollably. Your body is consuming itself. You will die very soon if you do not eat. Nothing else matters — FIND SOMETHING TO EAT AND PUT IT IN YOUR MOUTH. NOW.');
  } else if (citizen.food <= 0 && ticksWithoutFood >= 4) {
    parts.push('You are starving. The hunger is overwhelming — it is all you can think about. Your body is weakening. You MUST find something to eat immediately. Grab anything — plants, creatures, anything you can put in your mouth.');
  } else if (citizen.food <= 0 && ticksWithoutFood >= 2) {
    parts.push('Your stomach cramps painfully. You are very hungry. The urge to eat dominates your thoughts. You need to find food — pick up plants, catch creatures, anything edible. This is urgent.');
  } else if (citizen.food <= 0) {
    parts.push('Your stomach feels empty and uncomfortable. You are hungry. You should find something to eat soon — plants, small creatures, seeds, anything that looks edible.');
  } else if (citizen.food <= 1) {
    parts.push('You feel a growing hunger. Your stomach is not full. You should look for something to eat before long.');
  } else if (citizen.food <= 3) {
    parts.push('You are not particularly hungry.');
  } else {
    parts.push('You feel well-fed and satisfied.');
  }
  return parts.join(' ');
}

function describeRegion(region) {
  let desc = region.description + '\n\n';
  desc += 'You notice:\n';
  for (const [resource, feat] of Object.entries(region.features)) {
    const edibleHint = EDIBLE.includes(resource) ? ' — looks edible' : '';
    if (feat.amount > 20) desc += `- ${feat.description}${edibleHint}\n`;
    else if (feat.amount > 10) desc += `- ${feat.description} (though less plentiful than before)${edibleHint}\n`;
    else if (feat.amount > 3) desc += `- ${feat.description} (only a little remains)${edibleHint}\n`;
    else if (feat.amount > 0) desc += `- Almost nothing left of: ${feat.description}${edibleHint}\n`;
    else desc += `- Where there once were resources, now there is nothing.\n`;
  }
  // Show farm plots
  if (region.plots && region.plots.length > 0) {
    const sprouting = region.plots.filter(p => p.growth >= 1 && p.growth < 3).length;
    const growing = region.plots.filter(p => p.growth >= 3 && p.growth < 5).length;
    const mature = region.plots.filter(p => p.growth >= 5).length;
    if (sprouting > 0) desc += `- Tiny green shoots are poking out of the earth where seeds were buried.\n`;
    if (growing > 0) desc += `- Tall green stalks are growing from the ground in a patch — they are getting bigger.\n`;
    if (mature > 0) desc += `- Full-grown plants with heavy seed heads stand in a patch of earth — they look ready to pick.\n`;
  }
  if (region.weather !== 'clear') {
    const weatherDescs = {
      rain: 'Light rain falls from gray skies.',
      heavy_rain: 'Heavy rain pours down, making movement difficult.',
      drought: 'The air is dry and cracked. Everything looks parched.',
      storm: 'A violent storm rages. Wind and rain make it dangerous to move.',
      snow: 'White flakes fall from the sky. The ground is cold and covered.',
    };
    desc += `\n${weatherDescs[region.weather] || 'The weather is unusual.'}`;
  }
  return desc;
}

// ─── Identity recognition ─────────────────────────────────────────────
// Citizens track encounters. When they've met someone, they recognize them.
// No names are given — they form their own mental labels.

function describeOtherBeings(citizen, allCitizens) {
  const others = allCitizens.filter(c => c.alive && c.region === citizen.region && c.id !== citizen.id);
  if (others.length === 0) return 'You are alone here. No other beings are visible.';
  const encounters = citizen.encounters || {};
  const descs = others.map(c => {
    const timesMet = encounters[c.id]?.times || 0;
    let recognition = '';
    if (timesMet >= 5) recognition = ' You have seen this one many times. Their presence is very familiar.';
    else if (timesMet >= 3) recognition = ' You have seen this one before. Their features are becoming familiar.';
    else if (timesMet >= 1) recognition = ' Something about this one feels faintly familiar.';
    return `- A figure: ${c.physical_description}${recognition}`;
  });
  return `You see other beings nearby:\n${descs.join('\n')}`;
}

// ─── Recent events with recognition ──────────────────────────────────

function describeRecentEvents(citizen, region) {
  if (!region.recent_events || region.recent_events.length === 0) {
    return 'You have not noticed anyone doing anything recently.';
  }
  const encounters = citizen.encounters || {};
  const lines = region.recent_events.map(e => {
    let desc = e.description;
    // If this citizen recognizes the actor, note it
    if (e.actorId && e.actorId !== citizen.id && encounters[e.actorId]?.times >= 1) {
      const times = encounters[e.actorId].times;
      if (times >= 3) desc += ' (You recognize this figure — you have seen them before.)';
      else desc += ' (Something about this figure seems familiar.)';
    }
    return `- ${desc}`;
  });
  return `You noticed recently:\n${lines.join('\n')}`;
}

// ─── Last tick outcome ────────────────────────────────────────────────
// Tell the citizen what actually happened as a result of their last action

function describeLastOutcome(citizen) {
  if (!citizen._lastOutcome) return '';
  return `\nWHAT HAPPENED LAST TIME:\n${citizen._lastOutcome}\n`;
}

// ─── Memory compression ───────────────────────────────────────────────
// Instead of hard-dropping old memories, compress duplicates and similar entries

function compressMemories(memories) {
  if (memories.length <= 20) return memories;

  // Take oldest 10 and compress, keep newest 10 intact
  const old = memories.slice(0, memories.length - 10);
  const recent = memories.slice(-10);

  // Group by action type and deduplicate similar texts
  const groups = {};
  for (const m of old) {
    const text = typeof m === 'string' ? m : m.text;
    const action = typeof m === 'string' ? 'unknown' : (m.action || 'unknown');
    if (!groups[action]) groups[action] = [];
    groups[action].push(text);
  }

  const compressed = [];
  for (const [action, texts] of Object.entries(groups)) {
    // Deduplicate near-identical entries
    const unique = [...new Set(texts.map(t => t.toLowerCase().trim()))];
    if (unique.length === 1) {
      compressed.push({ text: `${texts[0]} (this happened many times)`, action, compressed: true });
    } else if (unique.length <= 3) {
      for (const t of texts.slice(0, 2)) {
        compressed.push({ text: t, action });
      }
    } else {
      // Keep first and last, summarize middle
      compressed.push({ text: texts[0], action });
      compressed.push({ text: `...and ${texts.length - 2} similar experiences of ${action}...`, action, compressed: true });
      compressed.push({ text: texts[texts.length - 1], action });
    }
  }

  return [...compressed.slice(0, 10), ...recent];
}

function describeMemories(citizen) {
  if (citizen.memory.length === 0) return 'You have no memories. Everything is new.';
  const recent = citizen.memory.slice(-30);
  return `You remember:\n${recent.map(m => `- ${typeof m === 'string' ? m : m.text}`).join('\n')}`;
}

// ─── Crafting recipes ─────────────────────────────────────────────────
// Citizens discover these by trying — no hints, just physics responding
const RECIPES = {
  'stone_tool':      { needs: { stone: 2, wood: 1 }, desc: 'You smashed the stones together and bound a sharp piece to the wood. It fits in your hand — a tool. It feels powerful.' },
  'wood_shelter':    { needs: { wood: 5 }, desc: 'You leaned the wood together and bound them. A rough structure stands — it blocks wind and rain. You could sleep under this.', effect: 'shelter' },
  'stone_wall':      { needs: { stone: 5 }, desc: 'You stacked the stones carefully. A low wall stands. It feels solid and permanent.', effect: 'shelter' },
  'fishing_spear':   { needs: { wood: 1, stone_tool: 1 }, desc: 'You sharpened the end of the wood with your tool. It is long and pointed — good for stabbing into water.' },
  'herb_poultice':   { needs: { herbs: 2 }, desc: 'You crushed the plants and pressed the wet mass against your skin. It stings, then soothes. Your body feels better.', effect: 'heal' },
};

function tryRecipe(citizen, makeDesc) {
  // Try to match what they're describing to a recipe
  const descLower = makeDesc.toLowerCase();
  const priorities = [];

  for (const [itemName, recipe] of Object.entries(RECIPES)) {
    // Check if they have the materials
    const hasAll = Object.entries(recipe.needs).every(([mat, qty]) => (citizen.inventory[mat] || 0) >= qty);
    if (!hasAll) continue;

    // Score based on description match
    let score = 0;
    if (itemName === 'stone_tool' && descLower.match(/tool|sharp|smash|hit.*stone|stone.*wood|bind|attach|combine/)) score = 3;
    if (itemName === 'wood_shelter' && descLower.match(/shelter|roof|cover|lean.*wood|build|structure|house|hut|protect/)) score = 3;
    if (itemName === 'stone_wall' && descLower.match(/wall|stack.*stone|pile.*stone|barrier|build.*stone|stone.*together/)) score = 3;
    if (itemName === 'fishing_spear' && descLower.match(/spear|sharp.*stick|point.*wood|stab|fish.*tool|weapon/)) score = 3;
    if (itemName === 'herb_poultice' && descLower.match(/crush.*plant|medicine|heal|bandage|poultice|rub.*herb|press.*plant/)) score = 3;
    // Generic "make something" with materials available — low score
    if (score === 0 && descLower.match(/make|build|create|craft|assemble|construct|combine|put.*together/)) score = 1;

    if (score > 0) priorities.push({ itemName, recipe, score });
  }

  if (priorities.length === 0) return null;
  priorities.sort((a, b) => b.score - a.score);
  return priorities[0];
}

const SYSTEM_PROMPT = `You are a being. You are not a character in a story. You are not aware of any simulation. You simply exist. You experience the world through your body and senses. You have no knowledge of civilization, technology, language, or culture. You only know what you can directly perceive and what you remember from your own experience.

You must respond in this EXACT JSON format and nothing else:
{
  "thinking": "your raw inner experience — sensations, urges, confusion, instincts (2-3 sentences)",
  "action": "what you physically do right now, described as simple bodily movements (1-2 sentences)",
  "memory_update": "one short sentence to remember about this moment"
}

Describe your action as raw physical movement — what your body actually does. Do not use abstract words like 'gather', 'rest', 'explore', 'interact'. Just describe what your body does. Examples: "I close my fingers around the seeds and shove them into my mouth." or "I walk toward where the light is different." or "I pick up the wet plant and chew it." or "I lie down on the ground and close my eyes."`;


function buildCitizenPrompt(citizen, region, allCitizens) {
  return `YOUR BODY:
${describeHealth(citizen)}
${describeSkills(citizen.skills)}

${describeInventory(citizen.inventory)}

YOUR SURROUNDINGS:
${describeRegion(region)}

OTHER BEINGS:
${describeOtherBeings(citizen, allCitizens)}

WHAT YOU NOTICED RECENTLY:
${describeRecentEvents(citizen, region)}
${describeLastOutcome(citizen)}
YOUR MEMORIES:
${describeMemories(citizen)}

What do you do?`;
}

// ─── Dynamic action interpretation via LLM ───────────────────────────
// A second LLM call interprets free-form action descriptions into mechanical effects.
// This replaces rigid regex pattern matching — the interpreter understands nuance,
// novel actions, and can detect multiple simultaneous effects.

const INTERPRETER_PROMPT = `You are a physics engine for a primitive world simulation. A being has described what their body does. You must determine the MECHANICAL EFFECTS of their action on the world.

You will receive:
- What the being did (their action description)
- What they are carrying (inventory)
- What resources exist in their current region
- Who else is nearby

Respond with ONLY this JSON (no other text):
{
  "effects": ["list of effect strings that apply"],
  "target_resource": "which resource they're interacting with, if any (e.g. 'grain', 'fish', 'stone')",
  "target_being": "description snippet of being they're interacting with, if any",
  "movement_direction": "any directional intent for travel (e.g. 'toward water', 'away', 'beyond')",
  "craft_description": "what they're trying to make/build, if any"
}

Valid effects (include ALL that apply — multiple can fire from one action):
- "eating" — putting something in their mouth, chewing, consuming, drinking
- "gathering" — picking up, grabbing, collecting something from the ground/environment
- "moving" — walking, running, travelling, leaving this area
- "resting" — lying down, sleeping, recovering, staying still to heal
- "fighting" — attacking, hitting, striking another being
- "crafting" — combining materials, building, constructing, making something
- "interacting" — approaching, gesturing to, touching another being (non-violent)
- "planting" — pushing seeds into earth, burying seeds
- "checking_plots" — examining/returning to where seeds were planted
- "exploring" — venturing to edges/borders, looking into the distance, seeking new lands

Examples:
- "I grab the seed heads and shove them in my mouth" → effects: ["gathering", "eating"], target_resource: "grain"
- "I walk toward where the air smells different" → effects: ["moving"], movement_direction: "toward different air"
- "I lie down and close my eyes" → effects: ["resting"]
- "I smash two stones together and bind the sharp piece to wood" → effects: ["crafting"], craft_description: "sharp stone bound to wood"
- "I splash water from the pool onto my wounds and drink some" → effects: ["eating"], target_resource: "fresh_water"
- "I pick up stones and stack them into a low wall" → effects: ["gathering", "crafting"], target_resource: "stone", craft_description: "stacking stones into wall"

Be generous with interpretation. If the being is clearly TRYING to eat, even clumsily, mark "eating". If they move AND gather, mark both.`;

function buildInterpreterPrompt(actionText, citizen, region, allCitizens) {
  const inv = Object.entries(citizen.inventory).filter(([, v]) => v > 0);
  const invStr = inv.length > 0 ? inv.map(([k, v]) => `${v} ${k}`).join(', ') : 'nothing';

  const resources = Object.entries(region.features)
    .filter(([, f]) => f.amount > 0)
    .map(([k, f]) => `${k} (${f.amount} available) — ${f.description}`);
  const resStr = resources.length > 0 ? resources.join('\n  ') : 'nothing';

  const others = allCitizens.filter(c => c.alive && c.region === citizen.region && c.id !== citizen.id);
  const othersStr = others.length > 0
    ? others.map(c => c.physical_description).join('; ')
    : 'no one';

  const plots = (region.plots || []).map(p => {
    if (p.growth >= 5) return 'mature crops ready to harvest';
    if (p.growth >= 3) return 'growing green stalks';
    if (p.growth >= 1) return 'tiny shoots';
    return 'freshly planted seeds';
  });
  const plotStr = plots.length > 0 ? `\nPlanted plots: ${plots.join(', ')}` : '';

  return `ACTION: "${actionText}"

CARRYING: ${invStr}
EDIBLE ITEMS IN INVENTORY: ${inv.filter(([k]) => EDIBLE.includes(k)).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}

REGION RESOURCES:
  ${resStr}${plotStr}

NEARBY BEINGS: ${othersStr}

What are the mechanical effects?`;
}

async function interpretAction(actionText, citizen, region, allCitizens) {
  const prompt = buildInterpreterPrompt(actionText, citizen, region, allCitizens);
  const result = await callLLM(INTERPRETER_PROMPT, prompt, 'claude-opus');

  if (result?.parsed) {
    const p = result.parsed;
    const effectList = Array.isArray(p.effects) ? p.effects : [];
    return {
      eating:        effectList.includes('eating'),
      gathering:     effectList.includes('gathering'),
      moving:        effectList.includes('moving'),
      resting:       effectList.includes('resting'),
      fighting:      effectList.includes('fighting'),
      crafting:      effectList.includes('crafting'),
      interacting:   effectList.includes('interacting'),
      planting:      effectList.includes('planting'),
      checkingPlots: effectList.includes('checking_plots'),
      exploring:     effectList.includes('exploring'),
      targetResource: p.target_resource || null,
      targetBeing:    p.target_being || null,
      movementDirection: p.movement_direction || null,
      craftDescription: p.craft_description || null,
      _raw: result.raw,
    };
  }

  // Fallback: no effects detected
  console.warn(`  ⚠️ Interpreter failed for "${actionText}", defaulting to nothing`);
  return {
    eating: false, gathering: false, moving: false, resting: false,
    fighting: false, crafting: false, interacting: false,
    planting: false, checkingPlots: false, exploring: false,
    targetResource: null, targetBeing: null, movementDirection: null, craftDescription: null,
  };
}

// Derive a primary action label for memory tagging (used by compressMemories)
function primaryEffect(effects) {
  if (effects.planting)      return 'plant';
  if (effects.checkingPlots) return 'check_plot';
  if (effects.fighting)      return 'fight';
  if (effects.crafting)      return 'craft';
  if (effects.eating || effects.gathering) return 'gather';
  if (effects.interacting)   return 'interact';
  if (effects.moving)        return 'move';
  if (effects.resting)       return 'rest';
  if (effects.exploring)     return 'explore';
  return 'nothing';
}

// ─── Action resolution ────────────────────────────────────────────────

async function resolveActions(citizens, actions, regions) {
  const events = [];
  const interactionDescs = {};

  for (const { citizenId, action, raw, prompt } of actions) {
    const citizen = citizens.find(c => c.id === citizenId);
    if (!citizen || !citizen.alive) continue;

    const region = regions[citizen.region];
    const parsed = action;

    // Derive action text from new format field, fall back gracefully
    const actionText = parsed.action || '';

    // Track encounters — all alive citizens in same region see each other
    const cohabitants = citizens.filter(c => c.alive && c.region === citizen.region && c.id !== citizen.id);
    for (const other of cohabitants) {
      if (!citizen.encounters) citizen.encounters = {};
      if (!citizen.encounters[other.id]) {
        citizen.encounters[other.id] = { times: 0, physDesc: other.physical_description };
      }
      citizen.encounters[other.id].times += 1;
      citizen.encounters[other.id].physDesc = other.physical_description;
      citizen.encounters[other.id].lastTick = actions[0]?.tick;
    }

    // Interpret the free-form action description via LLM
    console.log(`  🧠 Interpreting ${citizen.name}'s action: "${actionText}"`);
    const fx = await interpretAction(actionText, citizen, region, citizens);

    // ── Multiple effects can fire from one action ──────────────────────

    let didSomething = false;

    // 1. PLANTING: push seeds into earth
    if (fx.planting) {
      const hasGrain = (citizen.inventory.grain || 0) >= 1;
      const regionHasGrain = region.features?.grain?.amount >= 1;
      if (hasGrain || regionHasGrain) {
        if (hasGrain) {
          citizen.inventory.grain -= 1;
          if (citizen.inventory.grain <= 0) delete citizen.inventory.grain;
        } else {
          region.features.grain.amount -= 1;
        }
        if (!region.plots) region.plots = [];
        region.plots.push({
          plantedBy: citizen.id,
          plantedByName: citizen.name,
          plantedTick: actions[0]?.tick || 0,
          growth: 0,
          harvests: 0,
        });
        citizen._lastOutcome = 'You pushed seeds into the soft earth and covered them. Something about this feels important — like the ground accepted what you gave it.';
        events.push({ type: 'plant', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: actionText });
        region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) knelt down and pushed something into the earth, then covered it carefully.` });
        console.log(`  🌱 FARMING: ${citizen.name} planted seeds in ${region.name}`);
        didSomething = true;
      }
    }

    // 2. CHECKING PLOTS: examine growing seeds
    if (fx.checkingPlots && region.plots && region.plots.length > 0) {
      const bestPlot = region.plots.reduce((a, b) => b.growth > a.growth ? b : a, region.plots[0]);
      if (bestPlot.growth >= 5) {
        citizen._lastOutcome = 'You went back to the place where seeds were pushed into the earth. Tall plants with heavy seed heads now stand there — they grew! Something you put in the ground became food. This changes everything.';
      } else if (bestPlot.growth >= 3) {
        citizen._lastOutcome = 'You went back to where seeds were buried. Green stalks are pushing up from the earth, taller than before. Something is happening. The seeds are becoming plants.';
      } else if (bestPlot.growth >= 1) {
        citizen._lastOutcome = 'You went back to where seeds were pushed into the earth. Tiny green shoots are poking through the soil. Something is growing.';
      } else {
        citizen._lastOutcome = 'You looked at the place where seeds were pushed into the earth. The ground looks the same. Nothing has changed yet.';
      }
      events.push({ type: 'check_plot', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: actionText });
      region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) knelt by a patch of earth, examining something growing there.` });
      didSomething = true;
    }

    // 3. GATHERING: pick up resources from the region into inventory.
    // When eating is also intended, prefer edible resources so they can be eaten next.
    if (fx.gathering) {
      const features = Object.entries(region.features);
      let gathered = null;
      const descLower = actionText.toLowerCase();

      // First pass: match by interpreter's target resource, action text, or prefer edible when eating too
      for (const [resource, feat] of features) {
        if (feat.amount > 0) {
          const interpreterMatch = fx.targetResource && resource.includes(fx.targetResource.toLowerCase());
          const nameMatch = descLower.includes(resource) ||
            (feat.description && descLower.includes(feat.description.split(' ')[0].toLowerCase()));
          const ediblePreferred = fx.eating && EDIBLE.includes(resource);
          if (interpreterMatch || nameMatch || ediblePreferred) {
            const hasTool = (citizen.inventory.stone_tool || 0) > 0;
            const amount = Math.min(hasTool ? 4 : 2, feat.amount);
            feat.amount -= amount;
            citizen.inventory[resource] = (citizen.inventory[resource] || 0) + amount;
            gathered = { resource, amount };
            break;
          }
        }
      }

      // Second pass: take the first available resource
      if (!gathered) {
        for (const [resource, feat] of features) {
          if (feat.amount > 0) {
            const hasTool = (citizen.inventory.stone_tool || 0) > 0;
            const amount = Math.min(hasTool ? 4 : 2, feat.amount);
            feat.amount -= amount;
            citizen.inventory[resource] = (citizen.inventory[resource] || 0) + amount;
            gathered = { resource, amount };
            break;
          }
        }
      }

      if (gathered) {
        // If gathering crops, mark a harvest on a mature plot
        if (gathered.resource === 'crops' && region.plots) {
          const maturePlot = region.plots.find(p => p.growth >= 5 && p.harvests < 3);
          if (maturePlot) {
            maturePlot.harvests += 1;
            maturePlot.growth = 2;
            console.log(`  🌾 HARVEST: ${citizen.name} harvested crops in ${region.name} (harvest ${maturePlot.harvests}/3)`);
          }
        }
        citizen._lastOutcome = `Your hands found something. You picked up ${gathered.amount} ${gathered.resource}. You are now carrying it.`;
        events.push({ type: 'gather', citizen: citizen.id, citizenName: citizen.name, resource: gathered.resource, amount: gathered.amount, region: citizen.region, description: actionText });
        region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) bent down, picked something up from the ground, and kept it.` });
        didSomething = true;
      } else {
        citizen._lastOutcome = 'You searched but your hands found nothing. There was nothing here to pick up.';
        events.push({ type: 'gather_failed', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: 'Found nothing to gather.' });
        didSomething = true;
      }
    }

    // 4. EATING: consume one edible item from inventory, food += 1.
    // Runs after GATHERING so "grab + eat" works in a single action.
    if (fx.eating) {
      const edibleItems = Object.entries(citizen.inventory).filter(([k, v]) => EDIBLE.includes(k) && v > 0);
      if (edibleItems.length > 0) {
        const [food] = edibleItems[0];
        citizen.inventory[food]--;
        if (citizen.inventory[food] <= 0) delete citizen.inventory[food];
        citizen.food = Math.min(5, (citizen.food || 0) + 1);
        const foodNames = { grain: 'seeds', fish: 'fish', herbs: 'plants', fresh_water: 'water', crops: 'food from the earth' };
        citizen._lastOutcome = (citizen._lastOutcome ? citizen._lastOutcome + '\n' : '') +
          `You put ${foodNames[food] || food} in your mouth and chewed. Your stomach feels better.`;
        events.push({ type: 'eat', citizen: citizen.id, citizenName: citizen.name, food, region: citizen.region, description: actionText });
        didSomething = true;
      }
      // If nothing edible in hand, the eating intent yields no mechanical effect (citizen just mimed the motion)
    }

    // 5. CRAFTING: combining/building/making things
    if (fx.crafting && !fx.planting) {
      const craftText = fx.craftDescription || actionText;
      const recipe = tryRecipe(citizen, craftText);
      if (recipe) {
        for (const [mat, qty] of Object.entries(recipe.recipe.needs)) {
          citizen.inventory[mat] -= qty;
          if (citizen.inventory[mat] <= 0) delete citizen.inventory[mat];
        }
        if (recipe.recipe.effect === 'shelter') {
          citizen.has_shelter = true;
        } else if (recipe.recipe.effect === 'heal') {
          citizen.health = Math.min(citizen.max_health, citizen.health + 3);
        } else {
          citizen.inventory[recipe.itemName] = (citizen.inventory[recipe.itemName] || 0) + 1;
        }
        citizen._lastOutcome = recipe.recipe.desc;
        events.push({ type: 'craft', citizen: citizen.id, citizenName: citizen.name, item: recipe.itemName, region: citizen.region, description: actionText });
        region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) worked with objects in their hands, making something new.` });
        console.log(`  🔨 CRAFT: ${citizen.name} made ${recipe.itemName}`);
        didSomething = true;
      } else {
        citizen._lastOutcome = 'You manipulated objects with your hands. You are not sure if you made anything useful.';
        events.push({ type: 'make', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: actionText });
        region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) manipulated objects with their hands, assembling something.` });
        didSomething = true;
      }
    }

    // 6. FIGHTING: attacking another being
    if (fx.fighting) {
      const others = citizens.filter(c => c.alive && c.region === citizen.region && c.id !== citizen.id);
      if (others.length > 0) {
        // Try to match the interpreter's target being, otherwise random
        let target = others[Math.floor(Math.random() * others.length)];
        if (fx.targetBeing) {
          const tb = fx.targetBeing.toLowerCase();
          const matched = others.find(c => c.physical_description.toLowerCase().includes(tb) || tb.includes(c.physical_description.toLowerCase().split(' ')[0]));
          if (matched) target = matched;
        }
        const attackerPower = citizen.skills.strength + Math.random() * 3;
        const defenderPower = target.skills.strength + Math.random() * 3;
        if (attackerPower > defenderPower) {
          target.health -= 2;
          const lootable = Object.entries(target.inventory).filter(([, v]) => v > 0);
          let loot = null;
          if (lootable.length > 0) {
            const [item] = lootable[Math.floor(Math.random() * lootable.length)];
            target.inventory[item]--;
            citizen.inventory[item] = (citizen.inventory[item] || 0) + 1;
            loot = item;
          }
          citizen._lastOutcome = `You struck the other figure and overpowered them. They fell back, hurt.${loot ? ` You took ${loot} from them.` : ''}`;
          target._lastOutcome = `A figure attacked you. You were overpowered and hurt. Your body aches from the blows.${loot ? ` They took something from you.` : ''}`;
          events.push({ type: 'fight', citizen: citizen.id, citizenName: citizen.name, targetId: target.id, targetName: target.name, winner: citizen.id, loot, region: citizen.region, description: actionText });
        } else {
          citizen.health -= 2;
          citizen._lastOutcome = 'You attacked another figure but they were stronger. You were hurt and pushed back.';
          target._lastOutcome = `A figure (${citizen.physical_description}) attacked you but you fought them off. They seemed weaker than you.`;
          events.push({ type: 'fight', citizen: citizen.id, citizenName: citizen.name, targetId: target.id, targetName: target.name, winner: target.id, loot: null, region: citizen.region, description: actionText });
        }
        region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `Two figures clashed violently — (${citizen.physical_description}) and (${target.physical_description}).` });
        didSomething = true;
      }
    }

    // 7. INTERACTING: social approach/gesture (only if not fighting)
    if (fx.interacting && !fx.fighting) {
      const others = citizens.filter(c => c.alive && c.region === citizen.region && c.id !== citizen.id);
      if (others.length > 0) {
        const other = others[Math.floor(Math.random() * others.length)];
        citizen.relationships[other.id] = (citizen.relationships[other.id] || 0) + 1;
        other.relationships[citizen.id] = (other.relationships[citizen.id] || 0) + 1;
        if (!interactionDescs[citizen.id]) interactionDescs[citizen.id] = [];
        interactionDescs[citizen.id].push({ targetId: other.id, desc: actionText });
        if (!interactionDescs[other.id]) interactionDescs[other.id] = [];
        interactionDescs[other.id].push({ targetId: citizen.id, desc: `A figure (${citizen.physical_description}) approached you. They: ${actionText}`, incoming: true });
        citizen._lastOutcome = `You approached the figure (${other.physical_description}). You were close enough to see their face clearly.`;
        events.push({ type: 'interact', citizen: citizen.id, citizenName: citizen.name, targetId: other.id, targetName: other.name, region: citizen.region, description: actionText });
        region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) approached another figure (${other.physical_description}). They were close together.` });
        didSomething = true;
      } else {
        citizen._lastOutcome = 'You looked around for another being but no one was nearby.';
      }
    }

    // 8. MOVING: travelling to another region
    if (fx.moving) {
      const adj = region.adjacent || [];
      if (adj.length > 0) {
        const oldRegion = citizen.region;
        let dest = adj[Math.floor(Math.random() * adj.length)];
        // Check if the action text or interpreter mentions a specific destination
        const searchText = (actionText + ' ' + (fx.movementDirection || '')).toLowerCase();
        for (const a of adj) {
          if (searchText.includes(a.replace(/-/g, ' ')) || searchText.includes(a.split('-')[0])) {
            dest = a; break;
          }
        }
        regions[oldRegion].citizens = regions[oldRegion].citizens.filter(id => id !== citizen.id);
        regions[oldRegion].recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) walked away and disappeared.` });
        citizen.region = dest;
        regions[dest].citizens.push(citizen.id);
        regions[dest].recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A new figure (${citizen.physical_description}) arrived from somewhere else.` });
        citizen._lastOutcome = `You walked to a new place. The surroundings are different now — ${regions[dest]?.description?.split('.')[0] || dest}.`;
        events.push({ type: 'move', citizen: citizen.id, citizenName: citizen.name, from: oldRegion, to: dest, description: actionText });
        didSomething = true;
      }
    }

    // 9. RESTING: lying down, sleeping, healing
    if (fx.resting && !fx.moving) {
      citizen.health = Math.min(citizen.max_health, citizen.health + 1);
      citizen._lastOutcome = 'You rested. Your body feels slightly better than before.';
      events.push({ type: 'rest', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: actionText });
      region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) lay down and became still.` });
      didSomething = true;
    }

    // 10. EXPLORING: wandering toward the edge, possible region discovery
    if (fx.exploring && !fx.moving) {
      if (Math.random() < (0.08 + (citizen.skills.perception || 1) * 0.04)) {
        const newRegion = generateNewRegion(region, regions);
        if (newRegion) {
          region.adjacent.push(newRegion.id);
          newRegion.adjacent.push(region.id);
          regions[newRegion.id] = newRegion;
          writeJSON(join(WORLD_DIR, 'regions', `${newRegion.id}.json`), newRegion);
          writeJSON(join(WORLD_DIR, 'regions', `${region.id}.json`), region);
          citizen._lastOutcome = `You ventured far beyond the familiar ground. The terrain changed — you found a new place: ${newRegion.description.split('.')[0]}. You could travel there.`;
          events.push({ type: 'discovery', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, newRegion: newRegion.id, description: `${citizen.name} discovered new land: ${newRegion.name}` });
          region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) returned from far away, seeming excited about something.` });
          console.log(`  🗺️ DISCOVERY: ${citizen.name} found ${newRegion.name} (${newRegion.terrain})`);
          didSomething = true;
        }
      }
      if (!didSomething) {
        citizen._lastOutcome = 'You looked around and examined your surroundings. You did not pick anything up or find anything new.';
        events.push({ type: 'explore', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: actionText });
        region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) wandered around, examining things closely.` });
        didSomething = true;
      }
    }

    // 11. DEFAULT: nothing matched — stood still
    if (!didSomething) {
      citizen._lastOutcome = 'You stood still and did nothing. Time passed.';
      events.push({ type: 'nothing', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: actionText || 'Did nothing.' });
    }
  }

  // Process interaction content exchange
  for (const citizen of citizens) {
    if (!citizen.alive) continue;
    const incoming = (interactionDescs[citizen.id] || []).filter(i => i.incoming);
    if (incoming.length > 0) {
      const interactionSummary = incoming.map(i => i.desc).join('\n');
      citizen._lastOutcome = (citizen._lastOutcome || '') + '\n' + interactionSummary;
    }
  }

  // ─── Reproduction check ───────────────────────────────────────────────
  const interactPairs = events
    .filter(e => e.type === 'interact')
    .map(e => ({ a: citizens.find(c => c.id === e.citizen), b: citizens.find(c => c.id === e.targetId) }))
    .filter(p => p.a && p.b && p.a.alive && p.b.alive);

  for (const { a, b } of interactPairs) {
    const relAB = a.relationships[b.id] || 0;
    const relBA = b.relationships[a.id] || 0;
    const minRel = Math.min(relAB, relBA);
    if (
      minRel >= 30 &&
      a.health > 6 && b.health > 6 &&
      a.food > 2 && b.food > 2 &&
      Math.random() < 0.12
    ) {
      const child = spawnOffspring(a, b, regions[a.region]);
      citizens.push(child);
      writeJSON(join(WORLD_DIR, 'citizens', `${child.id}.json`), child);
      a._lastOutcome = (a._lastOutcome || '') + '\nA small new being appeared nearby. It is tiny and fragile.';
      b._lastOutcome = (b._lastOutcome || '') + '\nA small new being appeared nearby. It is tiny and fragile.';
      const region = regions[a.region];
      region.recent_events.push({
        actorId: child.id,
        who: child.physical_description,
        description: `A small new being (${child.physical_description}) appeared in this place.`,
      });
      events.push({
        type: 'birth',
        citizen: child.id,
        citizenName: child.name,
        parentA: a.id,
        parentAName: a.name,
        parentB: b.id,
        parentBName: b.name,
        region: a.region,
        description: `A new being, ${child.name}, appeared near ${a.name} and ${b.name}.`,
      });
      console.log(`  🌱 BIRTH: ${child.name} — offspring of ${a.name} & ${b.name}`);
    }
  }

  // ─── Survival costs ───────────────────────────────────────────────────
  for (const citizen of citizens) {
    if (!citizen.alive) continue;
    const region = regions[citizen.region];
    const season = SEASONS[((actions[0]?.tick || 1) - 1) % 12] || 'spring';
    const edibleItems = Object.entries(citizen.inventory).filter(([k, v]) => EDIBLE.includes(k) && v > 0);
    if (edibleItems.length > 0) {
      const [food] = edibleItems[0];
      citizen.inventory[food]--;
      if (citizen.inventory[food] <= 0) delete citizen.inventory[food];
      citizen.food = Math.min(5, (citizen.food || 0) + 1);
      citizen._starveTicks = 0;
      const foodNames = { grain: 'seeds', fish: 'fish', herbs: 'plants', fresh_water: 'water', crops: 'food from the earth' };
      citizen._lastOutcome = (citizen._lastOutcome || '') + `\nYou ate some ${foodNames[food] || food} from what you were carrying. Your stomach feels better.`;
    } else {
      citizen.food = Math.max(0, (citizen.food || 0) - 1);
    }
    if (citizen.food <= 0) {
      citizen._starveTicks = (citizen._starveTicks || 0) + 1;
      if (citizen._starveTicks % 2 === 0) {
        citizen.health -= 1;
        events.push({ type: 'starvation', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: `${citizen.name} grows weaker from hunger.` });
      }
    }
    if (season === 'winter' && !citizen.has_shelter) {
      const resistance = citizen.skills?.endurance >= 4 ? 0.5 : 1;
      if (Math.random() < resistance) {
        citizen.health -= 1;
        events.push({ type: 'exposure', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: `${citizen.name} suffers from the bitter cold.` });
      }
    }
    const weather = region?.weather || 'clear';
    if (weather === 'storm' && Math.random() < 0.2 && !citizen.has_shelter) {
      citizen.health -= 1;
      events.push({ type: 'weather_damage', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: `${citizen.name} is battered by the storm.` });
    }
    if (region?.terrain === 'mountain' && Math.random() < 0.08) {
      citizen.health -= 1;
      events.push({ type: 'terrain_damage', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: `${citizen.name} slips on loose rocks and is hurt.` });
    }
    if (citizen.health <= 0) {
      citizen.alive = false;
      events.push({ type: 'death', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, cause: citizen._starveTicks > 3 ? 'starvation' : 'health reached zero', description: `${citizen.name} has died.` });
    }
  }

  return events;
}

export async function runTick() {
  const clock = readJSON(join(WORLD_DIR, 'clock.json'));
  clock.tick += 1;
  clock.season = SEASONS[(clock.tick - 1) % 12];
  if ((clock.tick - 1) % 12 === 0 && clock.tick > 1) clock.year += 1;

  const regions = {};
  for (const file of readdirSync(join(WORLD_DIR, 'regions'))) {
    const region = readJSON(join(WORLD_DIR, 'regions', file));
    region.recent_events = [];
    regions[region.id] = region;
  }

  const REGEN = { wood: 3, stone: 1, grain: 4, fish: 3, iron_ore: 0.5, hide: 1, herbs: 2, fresh_water: 5 };
  for (const region of Object.values(regions)) {
    for (const [resource, feat] of Object.entries(region.features)) {
      const regen = REGEN[resource] || 0;
      const mult = SEASON_FOOD_MULT[clock.season] || 1;
      feat.amount = Math.min(30, feat.amount + regen * (EDIBLE.includes(resource) ? mult : 1));
    }
    // Grow farm plots
    if (region.plots && region.plots.length > 0) {
      const growthRate = { spring: 2, summer: 2, autumn: 1, winter: 0 };
      const rate = growthRate[clock.season] || 0;
      region.plots = region.plots.filter(plot => {
        if (plot.harvests >= 3) return false; // depleted
        plot.growth = Math.min(5, plot.growth + rate);
        return true;
      });
      // Mature plots add to region's grain supply
      const maturePlots = region.plots.filter(p => p.growth >= 5);
      if (maturePlots.length > 0) {
        if (!region.features.crops) {
          region.features.crops = { amount: 0, description: 'Green plants growing in neat patches where seeds were planted — they look ready to pick' };
        }
        // Each mature plot contributes 3 food
        region.features.crops.amount = maturePlots.length * 3;
      }
    }
  }

  const citizens = [];
  for (const file of readdirSync(join(WORLD_DIR, 'citizens'))) {
    citizens.push(readJSON(join(WORLD_DIR, 'citizens', file)));
  }

  const alive = citizens.filter(c => c.alive);
  console.log(`Tick ${clock.tick} | ${clock.season} Year ${clock.year} | ${alive.length} alive`);

  const thoughts = {};
  const actions = [];

  const promises = alive.map(async (citizen) => {
    const region = regions[citizen.region];
    const modelKey = citizen.model || 'gpt-4o-mini';
    const prompt = buildCitizenPrompt(citizen, region, citizens);

    const result = await callLLM(SYSTEM_PROMPT, prompt, modelKey);
    const parsed = result?.parsed || { thinking: 'confusion', action: 'stands still', memory_update: 'Nothing happened.' };

    thoughts[citizen.id] = {
      citizenName: citizen.name,
      model: result?.model || getModelConfig(modelKey).label,
      prompt,
      raw: result?.raw || 'LLM call failed',
      parsed,
    };

    actions.push({ citizenId: citizen.id, action: parsed, raw: result?.raw, prompt, tick: clock.tick });

    if (parsed.memory_update) {
      // Simple regex for memory tagging only (full interpretation happens in resolveActions)
      const actionStr = (parsed.action || '').toLowerCase();
      const memAction =
        /eat|chew|swallow|drink|mouth/.test(actionStr) ? 'gather' :
        /pick|grab|collect|gather|take|scoop/.test(actionStr) ? 'gather' :
        /walk|run|move|travel|leave|head/.test(actionStr) ? 'move' :
        /rest|sleep|lie\s+down|close.*eyes/.test(actionStr) ? 'rest' :
        /attack|hit|strike|fight|punch/.test(actionStr) ? 'fight' :
        /build|craft|make|combine|bind|stack/.test(actionStr) ? 'craft' :
        /approach|gesture|wave|touch/.test(actionStr) ? 'interact' :
        /plant|seed.*earth|bury.*seed/.test(actionStr) ? 'plant' :
        'nothing';
      citizen.memory.push({ text: parsed.memory_update, action: memAction });
      if (citizen.memory.length > 100) citizen.memory = compressMemories(citizen.memory);
    }

    console.log(`  ${citizen.name} [${getModelConfig(modelKey).short}]: ${parsed.action || '(no action)'}`);
  });

  await Promise.all(promises);

  const events = await resolveActions(citizens, actions, regions);

  writeJSON(join(WORLD_DIR, 'clock.json'), clock);
  for (const [id, region] of Object.entries(regions)) {
    writeJSON(join(WORLD_DIR, 'regions', `${id}.json`), region);
  }
  for (const citizen of citizens) {
    writeJSON(join(WORLD_DIR, 'citizens', `${citizen.id}.json`), citizen);
  }

  mkdirSync(join(WORLD_DIR, 'history'), { recursive: true });
  writeJSON(join(WORLD_DIR, 'history', `tick-${clock.tick}.json`), {
    tick: clock.tick, season: clock.season, year: clock.year,
    population: citizens.filter(c => c.alive).length, events,
  });

  mkdirSync(join(WORLD_DIR, 'thoughts'), { recursive: true });
  writeJSON(join(WORLD_DIR, 'thoughts', `tick-${clock.tick}.json`), thoughts);

  console.log(`  → ${events.length} events recorded`);
  return { tick: clock.tick, season: clock.season, year: clock.year, events, thoughts };
}
