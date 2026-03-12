// Tick engine — runs one simulation tick with LLM-powered citizen decisions
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { callLLM, getModelConfig } from './llm.js';

const WORLD_DIR = join(process.cwd(), 'world');

const SEASONS = ['spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter', 'winter', 'winter'];
const SEASON_FOOD_MULT = { spring: 1.0, summer: 1.5, autumn: 1.0, winter: 0.0 };
const EDIBLE = ['grain', 'fish', 'herbs', 'fresh_water'];

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
    hide: 'animal skins', iron_ore: 'chunks of glinting rock',
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
  for (const [, feat] of Object.entries(region.features)) {
    if (feat.amount > 0) desc += `- ${feat.description}\n`;
    else desc += `- Where there once were resources, now there is nothing.\n`;
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

function describeMemories(citizen) {
  if (citizen.memory.length === 0) return 'You have no memories. Everything is new.';
  const recent = citizen.memory.slice(-10);
  return `You remember:\n${recent.map(m => `- ${typeof m === 'string' ? m : m.text}`).join('\n')}`;
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
${describeOtherBeings(citizen, allCitizens)}

WHAT YOU NOTICED RECENTLY:
${describeRecentEvents(citizen, region)}
${describeLastOutcome(citizen)}
YOUR MEMORIES:
${describeMemories(citizen)}

What do you do?`;
}

// ─── Action resolution ────────────────────────────────────────────────

function resolveActions(citizens, actions, regions) {
  const events = [];
  // Collect interaction descriptions for exchange
  const interactionDescs = {};

  for (const { citizenId, action, raw, prompt } of actions) {
    const citizen = citizens.find(c => c.id === citizenId);
    if (!citizen || !citizen.alive) continue;

    const region = regions[citizen.region];
    const parsed = action;

    // Track presence — all alive citizens in same region see each other
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

    switch (parsed.action_type) {
      case 'gather': {
        const features = Object.entries(region.features);
        let gathered = null;
        const target = (parsed.action_details?.target || '').toLowerCase();
        for (const [resource, feat] of features) {
          if (feat.amount > 0 && (target.includes(resource) || target.includes(feat.description?.split(' ')[0]?.toLowerCase()))) {
            const amount = Math.min(2, feat.amount);
            feat.amount -= amount;
            citizen.inventory[resource] = (citizen.inventory[resource] || 0) + amount;
            gathered = { resource, amount };
            break;
          }
        }
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
          citizen._lastOutcome = `Your hands found something. You picked up ${gathered.amount} ${gathered.resource}. You are now carrying it.`;
          events.push({ type: 'gather', citizen: citizen.id, citizenName: citizen.name, resource: gathered.resource, amount: gathered.amount, region: citizen.region, description: parsed.action_description });
          region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) bent down, picked something up from the ground, and kept it.` });
        } else {
          citizen._lastOutcome = 'You searched but your hands found nothing. There was nothing here to pick up.';
          events.push({ type: 'gather_failed', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: 'Found nothing to gather.' });
        }
        break;
      }
      case 'move': {
        const adj = region.adjacent || [];
        if (adj.length > 0) {
          const oldRegion = citizen.region;
          let dest = adj[Math.floor(Math.random() * adj.length)];
          const target = (parsed.action_details?.target || '').toLowerCase();
          for (const a of adj) {
            if (target.includes(a.replace('-', ' ')) || target.includes(a.split('-')[0])) { dest = a; break; }
          }
          regions[oldRegion].citizens = regions[oldRegion].citizens.filter(id => id !== citizen.id);
          regions[oldRegion].recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) walked away and disappeared.` });
          citizen.region = dest;
          regions[dest].citizens.push(citizen.id);
          regions[dest].recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A new figure (${citizen.physical_description}) arrived from somewhere else.` });
          const destName = regions[dest]?.name || dest;
          citizen._lastOutcome = `You walked to a new place. The surroundings are different now — ${regions[dest]?.description?.split('.')[0] || destName}.`;
          events.push({ type: 'move', citizen: citizen.id, citizenName: citizen.name, from: oldRegion, to: dest, description: parsed.action_description });
        }
        break;
      }
      case 'rest': {
        citizen.health = Math.min(citizen.max_health, citizen.health + 1);
        citizen._lastOutcome = 'You rested. Your body feels slightly better than before.';
        events.push({ type: 'rest', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: parsed.action_description });
        region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) lay down and became still.` });
        break;
      }
      case 'interact': {
        const others = citizens.filter(c => c.alive && c.region === citizen.region && c.id !== citizen.id);
        if (others.length > 0) {
          const other = others[Math.floor(Math.random() * others.length)];
          citizen.relationships[other.id] = (citizen.relationships[other.id] || 0) + 1;
          other.relationships[citizen.id] = (other.relationships[citizen.id] || 0) + 1;
          // Store the interaction for content exchange later
          if (!interactionDescs[citizen.id]) interactionDescs[citizen.id] = [];
          interactionDescs[citizen.id].push({ targetId: other.id, desc: parsed.action_description });
          // The other citizen will see what this one did
          if (!interactionDescs[other.id]) interactionDescs[other.id] = [];
          interactionDescs[other.id].push({ targetId: citizen.id, desc: `A figure (${citizen.physical_description}) approached you. They: ${parsed.action_description}`, incoming: true });
          citizen._lastOutcome = `You approached the figure (${other.physical_description}). You were close enough to see their face clearly.`;
          events.push({ type: 'interact', citizen: citizen.id, citizenName: citizen.name, targetId: other.id, targetName: other.name, region: citizen.region, description: parsed.action_description });
          region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) approached another figure (${other.physical_description}). They were close together.` });
        } else {
          citizen._lastOutcome = 'You looked around for another being but no one was nearby.';
        }
        break;
      }
      case 'explore': {
        const desc = (parsed.action_description || '').toLowerCase();
        const isActuallyGathering = desc.match(/pick|grab|take|pull|eat|consume|put.*(mouth|eat)|collect|scoop|catch|pluck|harvest|search.*food|search.*edible|search.*eat|find.*food|find.*edible|gather|forag|hungr|desper.*food|urgent.*food/);
        if (isActuallyGathering) {
          const features = Object.entries(region.features);
          let found = false;
          for (const [resource, feat] of features) {
            if (feat.amount > 0) {
              const amount = Math.min(2, feat.amount);
              feat.amount -= amount;
              citizen.inventory[resource] = (citizen.inventory[resource] || 0) + amount;
              citizen._lastOutcome = `While searching, your hands found something — ${amount} ${resource}. You picked it up and kept it.`;
              events.push({ type: 'gather', citizen: citizen.id, citizenName: citizen.name, resource, amount, region: citizen.region, description: parsed.action_description });
              region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) searched around, found something on the ground, and picked it up.` });
              found = true;
              break;
            }
          }
          if (!found) {
            citizen._lastOutcome = 'You searched desperately but found nothing to pick up or eat. Your hands came up empty.';
            events.push({ type: 'gather_failed', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: parsed.action_description });
          }
        } else {
          citizen._lastOutcome = 'You looked around and examined your surroundings. You did not pick anything up or find anything new.';
          events.push({ type: 'explore', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: parsed.action_description });
          region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) wandered around, examining things closely.` });
        }
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
            events.push({ type: 'fight', citizen: citizen.id, citizenName: citizen.name, targetId: target.id, targetName: target.name, winner: citizen.id, loot, region: citizen.region, description: parsed.action_description });
          } else {
            citizen.health -= 2;
            citizen._lastOutcome = 'You attacked another figure but they were stronger. You were hurt and pushed back.';
            target._lastOutcome = `A figure (${citizen.physical_description}) attacked you but you fought them off. They seemed weaker than you.`;
            events.push({ type: 'fight', citizen: citizen.id, citizenName: citizen.name, targetId: target.id, targetName: target.name, winner: target.id, loot: null, region: citizen.region, description: parsed.action_description });
          }
          region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `Two figures clashed violently — (${citizen.physical_description}) and (${target.physical_description}).` });
        }
        break;
      }
      case 'make': {
        citizen._lastOutcome = 'You manipulated objects with your hands. You are not sure if you made anything useful.';
        events.push({ type: 'make', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: parsed.action_description });
        region.recent_events.push({ actorId: citizen.id, who: citizen.physical_description, description: `A figure (${citizen.physical_description}) manipulated objects with their hands, assembling something.` });
        break;
      }
      default: {
        citizen._lastOutcome = 'You stood still and did nothing. Time passed.';
        events.push({ type: 'nothing', citizen: citizen.id, citizenName: citizen.name, region: citizen.region, description: parsed.action_description || 'Did nothing.' });
        break;
      }
    }
  }

  // Process interaction content exchange — add to last outcome
  for (const citizen of citizens) {
    if (!citizen.alive) continue;
    const incoming = (interactionDescs[citizen.id] || []).filter(i => i.incoming);
    if (incoming.length > 0) {
      const interactionSummary = incoming.map(i => i.desc).join('\n');
      citizen._lastOutcome = (citizen._lastOutcome || '') + '\n' + interactionSummary;
    }
  }

  // ─── Reproduction check ───────────────────────────────────────────
  // When two bonded, healthy, well-fed citizens interact — small chance of new life
  const interactPairs = events
    .filter(e => e.type === 'interact')
    .map(e => ({ a: citizens.find(c => c.id === e.citizen), b: citizens.find(c => c.id === e.targetId) }))
    .filter(p => p.a && p.b && p.a.alive && p.b.alive);

  for (const { a, b } of interactPairs) {
    const relAB = a.relationships[b.id] || 0;
    const relBA = b.relationships[a.id] || 0;
    const minRel = Math.min(relAB, relBA);
    if (
      minRel >= 5 &&
      a.health > 6 && b.health > 6 &&
      a.food > 2 && b.food > 2 &&
      Math.random() < 0.12
    ) {
      // New life
      const child = spawnOffspring(a, b, regions[a.region]);
      citizens.push(child);
      writeJSON(join(WORLD_DIR, 'citizens', `${child.id}.json`), child);

      // Parents see something
      a._lastOutcome = (a._lastOutcome || '') + '\nA small new being appeared nearby. It is tiny and fragile.';
      b._lastOutcome = (b._lastOutcome || '') + '\nA small new being appeared nearby. It is tiny and fragile.';

      // Region event
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

  // Survival costs
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
    const parsed = result?.parsed || { thinking: 'confusion', action_description: 'stands still', action_type: 'nothing', action_details: {}, memory_update: 'Nothing happened.' };

    thoughts[citizen.id] = {
      citizenName: citizen.name,
      model: result?.model || getModelConfig(modelKey).label,
      prompt,
      raw: result?.raw || 'LLM call failed',
      parsed,
    };

    actions.push({ citizenId: citizen.id, action: parsed, raw: result?.raw, prompt, tick: clock.tick });

    if (parsed.memory_update) {
      citizen.memory.push({ text: parsed.memory_update, action: parsed.action_type || 'nothing' });
      if (citizen.memory.length > 20) citizen.memory = citizen.memory.slice(-20);
    }

    console.log(`  ${citizen.name} [${getModelConfig(modelKey).short}]: ${parsed.action_type} — ${parsed.action_description}`);
  });

  await Promise.all(promises);

  const events = resolveActions(citizens, actions, regions);

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
