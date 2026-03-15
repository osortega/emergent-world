// World initialization — creates the starting world state
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const WORLD_DIR = join(process.cwd(), 'world');

const REGIONS = {
  'northern-forest': {
    name: 'Northern Forest',
    terrain: 'forest',
    description: 'Dense woodland with tall dark trees. The ground is thick with fallen branches, moss, and undergrowth. Small animals rustle in the shadows. The air smells of pine and damp earth.',
    features: {
      wood: { amount: 25, description: 'Fallen branches and thick trunks everywhere' },
      hide: { amount: 15, description: 'Animal tracks and signs of small creatures' },
      herbs: { amount: 12, description: 'Strange plants growing in shaded patches' },
    },
    adjacent: ['river-valley', 'mountain-pass'],
    weather: 'clear',
    recent_events: [],
    citizens: [],
  },
  'river-valley': {
    name: 'River Valley',
    terrain: 'plains',
    description: 'A wide valley with a river running through it. The earth is soft and dark. Tall grasses sway in the wind. Fish are visible in the shallow water. The air is warm and humid.',
    features: {
      grain: { amount: 20, description: 'Tall grasses with heavy seed heads' },
      fresh_water: { amount: 30, description: 'Clear flowing water in the river' },
      fish: { amount: 20, description: 'Silver shapes darting in the shallows' },
    },
    adjacent: ['northern-forest', 'coastal-plains', 'mountain-pass'],
    weather: 'clear',
    recent_events: [],
    citizens: [],
  },
  'coastal-plains': {
    name: 'Coastal Plains',
    terrain: 'coast',
    description: 'Flat windswept land meeting a vast body of water. Waves crash against rocks. Seabirds circle overhead. Tide pools hold small creatures. Flat stones are scattered everywhere.',
    features: {
      fish: { amount: 22, description: 'Creatures in tide pools and shallow water' },
      stone: { amount: 18, description: 'Flat stones and rounded rocks along the shore' },
      herbs: { amount: 10, description: 'Hardy plants growing between rocks' },
    },
    adjacent: ['river-valley', 'salt-marshes'],
    weather: 'clear',
    recent_events: [],
    citizens: [],
  },
  'mountain-pass': {
    name: 'Mountain Pass',
    terrain: 'mountain',
    description: 'A narrow path between towering rock faces. The air is thin and cold. Glinting minerals are visible in the cliff walls. Loose scree shifts underfoot. The wind howls through gaps.',
    features: {
      stone: { amount: 25, description: 'Loose rocks and cliff faces everywhere' },
      iron_ore: { amount: 15, description: 'Glinting metallic veins in the rock face' },
    },
    adjacent: ['northern-forest', 'river-valley'],
    weather: 'clear',
    recent_events: [],
    citizens: [],
  },
  'salt-marshes': {
    name: 'Salt Marshes',
    terrain: 'wetland',
    description: 'Murky shallow water stretches in every direction. Thick mud sucks at your feet. Strange twisted plants grow from the water. Insects buzz constantly. The air is heavy and warm.',
    features: {
      herbs: { amount: 18, description: 'Unusual plants growing from murky water' },
      fish: { amount: 14, description: 'Things moving beneath the murky surface' },
      hide: { amount: 10, description: 'Tracks of creatures in the mud' },
    },
    adjacent: ['coastal-plains'],
    weather: 'clear',
    recent_events: [],
    citizens: [],
  },
};

// Physical descriptions — no cultural loading, just bodies
const CITIZENS = [
  { name: 'Eron', physical_description: 'Tall and broad-shouldered with dark tangled hair and rough heavy hands', region: 'northern-forest', skills: { strength: 4, dexterity: 2, perception: 2, endurance: 3, social: 1, curiosity: 1 } },
  { name: 'Thara', physical_description: 'Medium build with sun-darkened skin and a calm steady gaze', region: 'river-valley', skills: { strength: 2, dexterity: 2, perception: 3, endurance: 2, social: 2, curiosity: 2 } },
  { name: 'Mira', physical_description: 'Short and sturdy with thick arms and a wide open face', region: 'coastal-plains', skills: { strength: 3, dexterity: 2, perception: 2, endurance: 3, social: 2, curiosity: 1 } },
  { name: 'Dask', physical_description: 'Tall and thin with angular features and constantly moving eyes', region: 'river-valley', skills: { strength: 1, dexterity: 3, perception: 4, endurance: 1, social: 1, curiosity: 3 } },
  { name: 'Zev', physical_description: 'Wiry and restless with bright curious eyes and dirt under every nail', region: 'salt-marshes', skills: { strength: 2, dexterity: 2, perception: 3, endurance: 1, social: 1, curiosity: 4 } },
];

function init() {
  // Create directories
  for (const dir of ['world', 'world/citizens', 'world/regions', 'world/history', 'world/thoughts', 'world/market']) {
    mkdirSync(join(WORLD_DIR, '..', dir), { recursive: true });
  }

  // Write clock
  writeFileSync(join(WORLD_DIR, 'clock.json'), JSON.stringify({ tick: 0, season: 'spring', year: 1 }, null, 2));

  // Write regions
  const regions = JSON.parse(JSON.stringify(REGIONS));
  for (const citizen of CITIZENS) {
    regions[citizen.region].citizens.push(citizen.name.toLowerCase());
  }
  for (const [id, region] of Object.entries(regions)) {
    writeFileSync(join(WORLD_DIR, 'regions', `${id}.json`), JSON.stringify({ id, ...region }, null, 2));
  }

  // Write citizens
  for (const c of CITIZENS) {
    const citizen = {
      id: c.name.toLowerCase(),
      name: c.name,
      physical_description: c.physical_description,
      skills: c.skills,
      inventory: {},
      memory: [],
      health: 10,
      max_health: 10,
      food: 3,
      region: c.region,
      has_shelter: false,
      relationships: {},
      encounters: {},
      alive: true,
      born_tick: 0,
      model: 'claude-opus',
      _starveTicks: 0,
      _lastOutcome: null,
    };
    writeFileSync(join(WORLD_DIR, 'citizens', `${citizen.id}.json`), JSON.stringify(citizen, null, 2));
  }

  // Write empty market
  writeFileSync(join(WORLD_DIR, 'market', 'offers.json'), JSON.stringify([], null, 2));

  console.log('✓ World initialized');
  console.log(`  ${Object.keys(REGIONS).length} regions, ${CITIZENS.length} citizens`);
  console.log(`  World directory: ${WORLD_DIR}`);
}

init();
