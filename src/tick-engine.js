// Tick engine — runs one simulation tick with LLM-powered citizen decisions
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { callLLM } from './llm.js';

const WORLD_DIR = join(process.cwd(), 'world');

const SEASONS = ['spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter'];
const SEASON_FOOD_MULT = { spring: 1.0, summer: 1.5, autumn: 1.0, winter: 0.0 };
const EDIBLE = ['grain', 'fish', 'herbs', 'fresh_water'];

function readJSON(path) { return JSON.parse(readFileSync(path, 'utf-8')); }
function writeJSON(path, data) { writeFileSync(path, JSON.stringify(data, null, 2)); }

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
  const descs = items.map(([item, count]) => {
    const names = {
      wood: 'pieces of wood',
      stone: 'stones',
      grain: 'handfuls of seeds/grain',
      fish: 'fish',
      herbs: 'bundles of plants',
      fresh_water: 'containers of water',
      hide: 'animal skins',
      iron_ore: 'chunks of glinting rock',
    };
    return `${count} ${names[item] || item}`;
  });
  return `You are carrying: ${descs.join(', ')}.`;
}

function describeHealth(citizen) {
  const parts = [];
  if (citizen.health <= 3) parts.push('You feel weak and in pain. Your body is failing.');
  else if (citizen.health <= 6) parts.push('You feel hurt and sore.');
  else if (citizen.health <= 8) parts.push('You feel mostly fine, with minor aches.');
  else parts.push('You feel healthy and strong.');

  if (citizen.food <= 0) parts.push('Your stomach aches with hunger. You desperately need to eat.');
  else if (citizen.food <= 1) parts.push('You feel hungry.');
  else if (citizen.food <= 3) parts.push('You are not particularly hungry.');
  else parts.push('You feel well-fed.');

  return parts.join(' ');
}

function describeRegion(region) {
  let desc = region.description + '\n\n';
  desc += 'You notice:\n';
  for (const [, feat] of Object.entries(region.features)) {
    if (feat.amount > 0) {
      desc += `- ${feat.description}\n`;
    } else {
      desc += `- Where there once were resources, now there is nothing.\n`;
    }
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

function describeOtherBeings(citizen, allCitizens, region) {
  const others = allCitizens.filter(c => c.alive && c.region === citizen.region && c.id !== citizen.id);
  if (others.length === 0) return 'You are alone here. No other beings are visible.';
  const descs = others.map(c => `- A figure: ${c.physical_description}`);
  return `You see other beings nearby:\n${descs.join('\n')}`;
}

function describeRecentEvents(region) {
  if (!region.recent_events || region.recent_events.length === 0) {
    return 'You have not noticed anyone doing anything recently.';
  }
  const lines = region.recent_events.map(e => `- ${e.description}`);
  return `You noticed recently:\n${lines.join('\n')}`;
}

function describeMemories(citizen) {
  if (citizen.memory.length === 0) return 'You have no memories. Everything is new.';
  const recent = citizen.memory.slice(-10);
  return `You remember:\n${recent.map(m => `- ${m}`).join('\n')}`;
}

const SYSTEM_PROMPT = `You are a being. You are not a character in a story. You are not aware of any simulation. You simply exist. You experience the world through your body and senses. You have no knowledge of civilization, technology, language, or culture. You only know what you can directly perceive and what you remember from your own experience.

You must respond in this EXACT JSON format and nothing else:
{
  "thinking": "your raw inner experience — sensations, urges, confusion, instincts (2-3 sentences)",
  "action_description": "what you physically do, described as simple bodily movements (1-2 sentences)",
  "action_type": "ONE of: gather, move, rest, interact, make, explore, fight, nothing",
  "action_details": { "target": "what you act on if relevant" },
  "memory_update": "one short sentence to remember about this moment"
}`;

function buildCitizenPrompt(citizen, region, allCitizens) {
  return `YOUR BODY:
${describeHealth(citizen)}
${describeSkills(citizen.skills)}

${describeInventory(citizen.inventory)}

YOUR SURROUNDINGS:
${describeRegion(region)}

OTHER BEINGS:
${describeOtherBeings(citizen, allCitizens, region)}

WHAT YOU NOTICED RECENTLY:
${describeRecentEvents(region)}

YOUR MEMORIES:
${describeMemories(citizen)}

What do you do?`;
}

function resolveActions(citizens, actions, regions) {
  const events = [];

  for (const { citizenId, action, raw, prompt } of actions) {
    const citizen = citizens.find(c => c.id === citizenId);
    if (!citizen || !citizen.alive) continue;

    const region = regions[citizen.region];
    const parsed = action;

    switch (parsed.action_type) {
      case 'gather': {
        // Find a resource in the region to gather
        const features = Object.entries(region.features);
        let gathered = null;
        const target = (parsed.action_details?.target || '').toLowerCase();

        // Try to match what they're going for
        for (const [resource, feat] of features) {
          if (feat.amount > 0 && (target.includes(resource) || target.includes(feat.description?.split(' ')[0]?.toLowerCase()))) {
            const amount = Math.min(2, feat.amount);
            feat.amount -= amount;
            citizen.inventory[resource] = (citizen.inventory[resource] || 0) + amount;
            gathered = { resource, amount };
            break;
          }
        }

        // If no match, grab whatever's available
        if (!gathered) {
          for (const [resource, feat] of features) {
            if (feat.amount > 0) {
              const amount = Math.min(2, feat.amount);
              feat.amount -= amount;
              citizen.inventory[resource] = (citizen.inventory[resource] || 0) + amount;
              gathered = { resource, amount };
              break;
            }
          }
        }

        if (gathered) {
          events.push({ type: 'gather', citizen: citizen.id, citizenName: citizen.name, resource: gathered.resource, amount: gathered.amount, region: citizen.region, description: parsed.action_description });
          region.recent_events.push({ who: citizen.physical_description, description: `A figure (${citizen.physical_description}) picked something up from the ground and kept it.` });
        } else {
          events.push({ type: 'gather_failed', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: 'Found nothing to gather.' });
        }
        break;
      }
      case 'move': {
        const adj = region.adjacent || [];
        if (adj.length > 0) {
          const oldRegion = citizen.region;
          // Try to match target, otherwise random
          let dest = adj[Math.floor(Math.random() * adj.length)];
          const target = (parsed.action_details?.target || '').toLowerCase();
          for (const a of adj) {
            if (target.includes(a.replace('-', ' ')) || target.includes(a.split('-')[0])) {
              dest = a;
              break;
            }
          }
          // Remove from old region
          regions[oldRegion].citizens = regions[oldRegion].citizens.filter(id => id !== citizen.id);
          regions[oldRegion].recent_events.push({ who: citizen.physical_description, description: `A figure (${citizen.physical_description}) walked away and disappeared.` });
          // Add to new region
          citizen.region = dest;
          regions[dest].citizens.push(citizen.id);
          regions[dest].recent_events.push({ who: citizen.physical_description, description: `A new figure (${citizen.physical_description}) arrived from somewhere else.` });
          events.push({ type: 'move', citizen: citizen.id, citizenName: citizen.name, from: oldRegion, to: dest, description: parsed.action_description });
        }
        break;
      }
      case 'rest': {
        citizen.health = Math.min(citizen.max_health, citizen.health + 1);
        events.push({ type: 'rest', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: parsed.action_description });
        region.recent_events.push({ who: citizen.physical_description, description: `A figure (${citizen.physical_description}) lay down and became still.` });
        break;
      }
      case 'interact': {
        const others = citizens.filter(c => c.alive && c.region === citizen.region && c.id !== citizen.id);
        if (others.length > 0) {
          const other = others[Math.floor(Math.random() * others.length)];
          citizen.relationships[other.id] = (citizen.relationships[other.id] || 0) + 1;
          other.relationships[citizen.id] = (other.relationships[citizen.id] || 0) + 1;
          events.push({ type: 'interact', citizen: citizen.id, citizenName: citizen.name, targetId: other.id, targetName: other.name, region: citizen.region, description: parsed.action_description });
          region.recent_events.push({ who: citizen.physical_description, description: `A figure (${citizen.physical_description}) approached another figure (${other.physical_description}) and they faced each other.` });
        }
        break;
      }
      case 'explore': {
        events.push({ type: 'explore', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: parsed.action_description });
        region.recent_events.push({ who: citizen.physical_description, description: `A figure (${citizen.physical_description}) wandered around, examining things closely.` });
        break;
      }
      case 'fight': {
        const others = citizens.filter(c => c.alive && c.region === citizen.region && c.id !== citizen.id);
        if (others.length > 0) {
          const target = others[Math.floor(Math.random() * others.length)];
          const attackerPower = citizen.skills.strength + Math.random() * 3;
          const defenderPower = target.skills.strength + Math.random() * 3;
          if (attackerPower > defenderPower) {
            target.health -= 2;
            // Loot one item
            const lootable = Object.entries(target.inventory).filter(([, v]) => v > 0);
            let loot = null;
            if (lootable.length > 0) {
              const [item] = lootable[Math.floor(Math.random() * lootable.length)];
              target.inventory[item]--;
              citizen.inventory[item] = (citizen.inventory[item] || 0) + 1;
              loot = item;
            }
            events.push({ type: 'fight', citizen: citizen.id, citizenName: citizen.name, targetId: target.id, targetName: target.name, winner: citizen.id, loot, region: citizen.region, description: parsed.action_description });
          } else {
            citizen.health -= 2;
            events.push({ type: 'fight', citizen: citizen.id, citizenName: citizen.name, targetId: target.id, targetName: target.name, winner: target.id, loot: null, region: citizen.region, description: parsed.action_description });
          }
          region.recent_events.push({ who: citizen.physical_description, description: `Two figures clashed violently — (${citizen.physical_description}) and (${target.physical_description}).` });
        }
        break;
      }
      case 'make': {
        events.push({ type: 'make', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: parsed.action_description });
        region.recent_events.push({ who: citizen.physical_description, description: `A figure (${citizen.physical_description}) manipulated objects with their hands, assembling something.` });
        break;
      }
      default: {
        events.push({ type: 'nothing', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: parsed.action_description || 'Did nothing.' });
        break;
      }
    }
  }

  // Survival costs
  for (const citizen of citizens) {
    if (!citizen.alive) continue;

    // Consume food
    const edibleItems = Object.entries(citizen.inventory).filter(([k, v]) => EDIBLE.includes(k) && v > 0);
    if (edibleItems.length > 0) {
      const [food] = edibleItems[0];
      citizen.inventory[food]--;
      if (citizen.inventory[food] <= 0) delete citizen.inventory[food];
      citizen.food = Math.min(5, (citizen.food || 0) + 1);
    } else {
      citizen.food = Math.max(0, (citizen.food || 0) - 1);
    }

    if (citizen.food <= 0) {
      citizen.health -= 1;
      events.push({ type: 'starvation', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: `${citizen.name} suffers from hunger.` });
    }

    // Death check
    if (citizen.health <= 0) {
      citizen.alive = false;
      events.push({ type: 'death', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, cause: 'health reached zero', description: `${citizen.name} has died.` });
    }
  }

  return events;
}

export async function runTick() {
  // Read state
  const clock = readJSON(join(WORLD_DIR, 'clock.json'));
  clock.tick += 1;
  clock.season = SEASONS[(clock.tick - 1) % 12];
  if ((clock.tick - 1) % 12 === 0 && clock.tick > 1) clock.year += 1;

  // Read regions
  const regions = {};
  for (const file of readdirSync(join(WORLD_DIR, 'regions'))) {
    const region = readJSON(join(WORLD_DIR, 'regions', file));
    region.recent_events = []; // Clear previous tick's events
    regions[region.id] = region;
  }

  // Resource regeneration
  const REGEN = { wood: 3, stone: 1, grain: 4, fish: 3, iron_ore: 0.5, hide: 1, herbs: 2, fresh_water: 5 };
  for (const region of Object.values(regions)) {
    for (const [resource, feat] of Object.entries(region.features)) {
      const regen = REGEN[resource] || 0;
      const mult = SEASON_FOOD_MULT[clock.season] || 1;
      feat.amount = Math.min(30, feat.amount + regen * (EDIBLE.includes(resource) ? mult : 1));
    }
  }

  // Read citizens
  const citizens = [];
  for (const file of readdirSync(join(WORLD_DIR, 'citizens'))) {
    citizens.push(readJSON(join(WORLD_DIR, 'citizens', file)));
  }

  const alive = citizens.filter(c => c.alive);
  console.log(`Tick ${clock.tick} | ${clock.season} Year ${clock.year} | ${alive.length} alive`);

  // Get each citizen's decision via LLM (parallel)
  const thoughts = {};
  const actions = [];

  const promises = alive.map(async (citizen) => {
    const region = regions[citizen.region];
    const prompt = buildCitizenPrompt(citizen, region, citizens);

    const result = await callLLM(SYSTEM_PROMPT, prompt);
    const parsed = result?.parsed || { thinking: 'confusion', action_description: 'stands still', action_type: 'nothing', action_details: {}, memory_update: 'Nothing happened.' };

    thoughts[citizen.id] = {
      citizenName: citizen.name,
      prompt,
      raw: result?.raw || 'LLM call failed',
      parsed,
    };

    actions.push({ citizenId: citizen.id, action: parsed, raw: result?.raw, prompt });

    // Add memory
    if (parsed.memory_update) {
      citizen.memory.push(parsed.memory_update);
      if (citizen.memory.length > 20) citizen.memory = citizen.memory.slice(-20);
    }

    console.log(`  ${citizen.name}: ${parsed.action_type} — ${parsed.action_description}`);
  });

  await Promise.all(promises);

  // Resolve all actions
  const events = resolveActions(citizens, actions, regions);

  // Write everything back
  writeJSON(join(WORLD_DIR, 'clock.json'), clock);
  for (const [id, region] of Object.entries(regions)) {
    writeJSON(join(WORLD_DIR, 'regions', `${id}.json`), region);
  }
  for (const citizen of citizens) {
    writeJSON(join(WORLD_DIR, 'citizens', `${citizen.id}.json`), citizen);
  }

  // Write history
  mkdirSync(join(WORLD_DIR, 'history'), { recursive: true });
  writeJSON(join(WORLD_DIR, 'history', `tick-${clock.tick}.json`), {
    tick: clock.tick,
    season: clock.season,
    year: clock.year,
    population: citizens.filter(c => c.alive).length,
    events,
  });

  // Write thoughts (behind the scenes)
  mkdirSync(join(WORLD_DIR, 'thoughts'), { recursive: true });
  writeJSON(join(WORLD_DIR, 'thoughts', `tick-${clock.tick}.json`), thoughts);

  console.log(`  → ${events.length} events recorded`);

  return { tick: clock.tick, season: clock.season, year: clock.year, events, thoughts };
}
