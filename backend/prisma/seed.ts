/**
 * Seeds NOIDA Authority: real geography, a fully staffed chain of command, and
 * enough lived-in complaint history that GRIE has genuine signal to score.
 *
 * Idempotent for reference data — everything upserts on a natural key.
 * Complaints are only generated when there are none, since they carry backdated
 * timestamps that should not stack on re-runs.
 */
import {
  ComplaintStatus,
  DepartmentStatus,
  JurisdictionLevel,
  PrismaClient,
  Priority,
  Rank,
  Trade,
} from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const PASSWORD = 'drishti123'
const DAY = 86_400_000

/** Deterministic PRNG so every teammate's seeded database looks identical. */
function makeRandom(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}
const random = makeRandom(20260825)
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!
const between = (min: number, max: number) => min + random() * (max - min)

// ---------------------------------------------------------------------------
// Geography — real Noida sectors, grouped into work circles and zones
// ---------------------------------------------------------------------------

const ZONES = [
  { code: 'Z1', name: 'Zone I — Central Noida', nameHi: 'क्षेत्र १ — मध्य नोएडा' },
  { code: 'Z2', name: 'Zone II — Expressway', nameHi: 'क्षेत्र २ — एक्सप्रेसवे' },
  { code: 'Z3', name: 'Zone III — Old Noida', nameHi: 'क्षेत्र ३ — पुराना नोएडा' },
]

const CIRCLES = [
  { code: 'WC1', name: 'Work Circle 1', zone: 'Z1' },
  { code: 'WC2', name: 'Work Circle 2', zone: 'Z1' },
  { code: 'WC3', name: 'Work Circle 3', zone: 'Z2' },
  { code: 'WC4', name: 'Work Circle 4', zone: 'Z2' },
  { code: 'WC5', name: 'Work Circle 5', zone: 'Z3' },
  { code: 'WC6', name: 'Work Circle 6', zone: 'Z3' },
]

const SECTORS = [
  { number: 12, name: 'Sector 12', circle: 'WC1', population: 18000, lat: 28.5921, lon: 77.3266 },
  { number: 15, name: 'Sector 15', circle: 'WC1', population: 14500, lat: 28.5836, lon: 77.3120 },
  { number: 22, name: 'Sector 22', circle: 'WC1', population: 21000, lat: 28.5836, lon: 77.3345 },
  { number: 18, name: 'Sector 18 (Market)', circle: 'WC2', population: 9000, lat: 28.5700, lon: 77.3210 },
  { number: 27, name: 'Sector 27', circle: 'WC2', population: 16000, lat: 28.5773, lon: 77.3287 },
  { number: 29, name: 'Sector 29', circle: 'WC2', population: 12500, lat: 28.5709, lon: 77.3350 },
  { number: 62, name: 'Sector 62', circle: 'WC3', population: 27000, lat: 28.6270, lon: 77.3720 },
  { number: 63, name: 'Sector 63', circle: 'WC3', population: 24000, lat: 28.6220, lon: 77.3810 },
  { number: 71, name: 'Sector 71', circle: 'WC3', population: 19500, lat: 28.6010, lon: 77.3810 },
  { number: 128, name: 'Sector 128', circle: 'WC4', population: 15000, lat: 28.5170, lon: 77.3660 },
  { number: 137, name: 'Sector 137', circle: 'WC4', population: 22000, lat: 28.4990, lon: 77.3900 },
  { number: 168, name: 'Sector 168', circle: 'WC4', population: 8000, lat: 28.4700, lon: 77.4180 },
  { number: 1, name: 'Sector 1', circle: 'WC5', population: 17000, lat: 28.5890, lon: 77.3120 },
  { number: 5, name: 'Sector 5 (Harola)', circle: 'WC5', population: 31000, lat: 28.5820, lon: 77.3170 },
  { number: 8, name: 'Sector 8', circle: 'WC5', population: 26000, lat: 28.5760, lon: 77.3050 },
  { number: 9, name: 'Sector 9', circle: 'WC6', population: 23000, lat: 28.5820, lon: 77.3020 },
  { number: 10, name: 'Sector 10', circle: 'WC6', population: 20000, lat: 28.5880, lon: 77.2980 },
  { number: 11, name: 'Sector 11', circle: 'WC6', population: 18500, lat: 28.5930, lon: 77.3060 },
]

// ---------------------------------------------------------------------------
// Departments — three live, the rest on the roadmap
// ---------------------------------------------------------------------------

const DEPARTMENTS = [
  {
    code: 'PHD',
    name: 'Public Health Department',
    nameHi: 'जन स्वास्थ्य विभाग',
    description: 'Sanitation, waste collection, street sweeping and public conveniences.',
    icon: '🧹',
    status: DepartmentStatus.ACTIVE,
    sortOrder: 1,
    designations: {
      HOD: ['General Manager (Public Health)', 'GM'],
      ZONAL_OFFICER: ['Chief Sanitary Officer', 'CSO'],
      CIRCLE_OFFICER: ['Sanitary Officer', 'SO'],
      SECTION_OFFICER: ['Sanitary Inspector', 'SI'],
      FIELD_WORKER: ['Safai Karamchari', 'SK'],
    },
  },
  {
    code: 'EMD',
    name: 'Electrical & Mechanical Department',
    nameHi: 'विद्युत एवं यांत्रिक विभाग',
    description: 'Street lighting, pump houses and authority electrical assets.',
    icon: '💡',
    status: DepartmentStatus.ACTIVE,
    sortOrder: 2,
    designations: {
      HOD: ['General Manager (Electrical)', 'GM'],
      ZONAL_OFFICER: ['Superintending Engineer (Elect.)', 'SE'],
      CIRCLE_OFFICER: ['Executive Engineer (Elect.)', 'EE'],
      SECTION_OFFICER: ['Junior Engineer (Elect.)', 'JE'],
      FIELD_WORKER: ['Lineman', 'LM'],
    },
  },
  {
    code: 'CIVIL',
    name: 'Civil Engineering Department',
    nameHi: 'सिविल अभियंत्रण विभाग',
    description: 'Roads, footpaths, drains, culverts and civil maintenance.',
    icon: '🛣️',
    status: DepartmentStatus.ACTIVE,
    sortOrder: 3,
    designations: {
      HOD: ['General Manager (Civil)', 'GM'],
      ZONAL_OFFICER: ['Superintending Engineer (Civil)', 'SE'],
      CIRCLE_OFFICER: ['Executive Engineer (Civil)', 'EE'],
      SECTION_OFFICER: ['Junior Engineer (Civil)', 'JE'],
      FIELD_WORKER: ['Beldar', 'BD'],
    },
  },
  {
    code: 'JAL',
    name: 'Water & Sewerage Department',
    nameHi: 'जल एवं सीवर विभाग',
    description: 'Water supply lines, tubewells, sewer networks and STPs.',
    icon: '🚰',
    status: DepartmentStatus.COMING_SOON,
    sortOrder: 4,
    roadmapNote: 'Next department to go live. Needs the tubewell and STP asset register first.',
  },
  {
    code: 'HORT',
    name: 'Horticulture Department',
    nameHi: 'उद्यान विभाग',
    description: 'Parks, green belts, central verges and tree maintenance.',
    icon: '🌳',
    status: DepartmentStatus.COMING_SOON,
    sortOrder: 5,
    roadmapNote: 'Planned once the park and green-belt inventory is digitised.',
  },
  {
    code: 'PLAN',
    name: 'Planning & Architecture',
    nameHi: 'नियोजन एवं वास्तुकला',
    description: 'Layout plans, building sanctions and land use.',
    icon: '📐',
    status: DepartmentStatus.COMING_SOON,
    sortOrder: 6,
    roadmapNote: 'Requires integration with the building plan approval system.',
  },
  {
    code: 'LAND',
    name: 'Land & Property Department',
    nameHi: 'भूमि एवं संपत्ति विभाग',
    description: 'Allotments, lease rent, transfers and encroachment removal.',
    icon: '📜',
    status: DepartmentStatus.COMING_SOON,
    sortOrder: 7,
    roadmapNote: 'Blocked on the property records migration.',
  },
  {
    code: 'TRAF',
    name: 'Traffic & Transport Cell',
    nameHi: 'यातायात एवं परिवहन प्रकोष्ठ',
    description: 'Signals, road marking, parking and traffic furniture.',
    icon: '🚦',
    status: DepartmentStatus.COMING_SOON,
    sortOrder: 8,
    roadmapNote: 'Coordination with Gautam Buddh Nagar traffic police still to be agreed.',
  },
]

const CATEGORIES = [
  { code: 'GARBAGE', name: 'Garbage Not Collected', nameHi: 'कूड़ा नहीं उठाया गया', dept: 'PHD', sla: 24, icon: '🗑️', trade: Trade.SAFAI_KARAMCHARI, keywords: 'garbage,kachra,kooda,waste,trash,dustbin,rubbish,dump,safai,bin' },
  { code: 'SWEEPING', name: 'Street Not Swept', nameHi: 'सड़क की सफाई नहीं', dept: 'PHD', sla: 24, icon: '🧹', trade: Trade.SAFAI_KARAMCHARI, keywords: 'sweeping,sweep,jhadu,safai nahi,dirty road,dust,malba,debris' },
  { code: 'DEAD_ANIMAL', name: 'Dead Animal Removal', nameHi: 'मृत पशु हटाना', dept: 'PHD', sla: 6, icon: '⚠️', trade: Trade.SAFAI_KARAMCHARI, keywords: 'dead animal,dead dog,mrit,carcass,smell,badbu,stray dead' },
  { code: 'TOILET', name: 'Public Toilet Issue', nameHi: 'सार्वजनिक शौचालय', dept: 'PHD', sla: 48, icon: '🚻', trade: Trade.SAFAI_KARAMCHARI, keywords: 'toilet,shauchalay,public toilet,washroom,urinal' },

  { code: 'STREETLIGHT', name: 'Streetlight Not Working', nameHi: 'स्ट्रीट लाइट खराब', dept: 'EMD', sla: 48, icon: '💡', trade: Trade.LINEMAN, keywords: 'streetlight,street light,light,batti,lamp,pole,dark,andhera,bijli,khambha' },
  { code: 'CABLE_HANG', name: 'Hanging or Broken Cable', nameHi: 'लटकता हुआ तार', dept: 'EMD', sla: 12, icon: '⚡', trade: Trade.LINEMAN, keywords: 'cable,wire,tar,hanging wire,live wire,current,spark,shock,electric' },
  { code: 'PUMP', name: 'Pump House Fault', nameHi: 'पंप हाउस खराबी', dept: 'EMD', sla: 24, icon: '⚙️', trade: Trade.LINEMAN, keywords: 'pump,motor,pump house,booster,machine kharab' },

  { code: 'POTHOLE', name: 'Pothole / Damaged Road', nameHi: 'सड़क में गड्ढा', dept: 'CIVIL', sla: 72, icon: '🕳️', trade: Trade.BELDAR, keywords: 'pothole,gaddha,gaddhe,road,sadak,damaged road,broken road,tar,patchwork' },
  { code: 'DRAIN', name: 'Blocked Drain / Sewage Overflow', nameHi: 'नाली जाम', dept: 'CIVIL', sla: 48, icon: '🌊', trade: Trade.BELDAR, keywords: 'drain,nali,nalla,sewage,overflow,blockage,gutter,choked,jam,water logging,jalbharav' },
  { code: 'FOOTPATH', name: 'Damaged Footpath', nameHi: 'क्षतिग्रस्त फुटपाथ', dept: 'CIVIL', sla: 96, icon: '🚶', trade: Trade.MASON, keywords: 'footpath,pavement,tile,paver,kerb,broken tile,walkway' },
]

// ---------------------------------------------------------------------------
// Complaint templates, English and Hinglish as citizens actually write
// ---------------------------------------------------------------------------

const TEMPLATES: Record<string, Array<{ title: string; description: string }>> = {
  GARBAGE: [
    { title: 'Garbage not collected for four days', description: 'The community bin at our corner is overflowing and waste has spilled onto the footpath. Stray dogs are scattering it further every night.' },
    { title: 'Kachra gaadi nahi aa rahi', description: 'Pichle ek hafte se kachra gaadi humare block mein nahi aayi hai. Poora kooda sadak par pada hua hai aur badbu aa rahi hai.' },
    { title: 'Illegal dumping behind the market', description: 'People are dumping construction malba behind the market block. It has grown into a large rubbish pile over the past month.' },
  ],
  SWEEPING: [
    { title: 'Street has not been swept in a week', description: 'The service lane has not been swept for over a week. Dust and leaves have piled up along the entire stretch.' },
    { title: 'Safai karamchari nahi aaye', description: 'Humari gali mein safai karamchari kai din se nahi aaye. Jhadu bilkul nahi lagi hai aur dhool bahut hai.' },
  ],
  DEAD_ANIMAL: [
    { title: 'Dead stray dog near the park gate', description: 'A dead stray dog has been lying near the park gate since yesterday morning. The smell is severe and children pass this way to school.' },
  ],
  TOILET: [
    { title: 'Public toilet is unusable', description: 'The public toilet near the bus stop has no water and has not been cleaned in days. It is completely unusable.' },
  ],
  STREETLIGHT: [
    { title: 'Street light not working for a week', description: 'The street light outside our block has been off for over a week. The entire lane is dark after 7pm and it feels unsafe.' },
    { title: 'Gali ki batti kharab hai', description: 'Humari gali ki batti kaam nahi kar rahi. Raat ko poora andhera rehta hai, ladkiyon ko ghar aane mein darr lagta hai.' },
    { title: 'Four poles dark on the main road', description: 'Four consecutive lamp poles on the main road are dark. Possibly a fault at the pole junction rather than the individual lamps.' },
  ],
  CABLE_HANG: [
    { title: 'Live wire hanging low over footpath', description: 'An electrical cable has come loose from the pole and is hanging barely above head height over the footpath. This is dangerous.' },
    { title: 'Tar latak raha hai, spark ho raha hai', description: 'Khambhe se tar latak raha hai aur raat ko spark hota hai. Koi bada hadsa ho sakta hai, jaldi theek karwayein.' },
  ],
  PUMP: [
    { title: 'Pump house motor not running', description: 'The booster pump serving our block has not run since Tuesday. Upper floors are getting no supply at all.' },
  ],
  POTHOLE: [
    { title: 'Deep pothole at the sector crossing', description: 'There is a deep pothole right at the crossing. Two-wheelers are skidding, particularly after dark and after rain.' },
    { title: 'Sadak par bade gaddhe hain', description: 'Humare sector ki sadak par bahut bade gaddhe ho gaye hain. Baarish ke baad paani bhar jata hai aur gaddha dikhta nahi hai.' },
    { title: 'Road surface broken after rain', description: 'The tar layer has come off completely after last week rain. The damaged stretch is roughly thirty metres long.' },
  ],
  DRAIN: [
    { title: 'Drain blocked, sewage on the road', description: 'The drain outside our gate is choked and sewage water is flowing onto the road. The smell is unbearable through the day.' },
    { title: 'Nali jam hai, paani overflow ho raha', description: 'Nali poori tarah band ho gayi hai. Gandaa paani ghar ke saamne jama ho raha hai aur machhar bahut badh gaye hain.' },
  ],
  FOOTPATH: [
    { title: 'Footpath tiles broken and uneven', description: 'Paver tiles along the footpath have come loose and several are missing. An elderly resident tripped here last week.' },
  ],
}

// ---------------------------------------------------------------------------
// Staff roster
// ---------------------------------------------------------------------------

/** Officers posted above sector level, keyed by department and rank. */
const SENIOR_STAFF = [
  // Public Health
  { email: 'gm.phd@noidaauthority.in', name: 'Sunita Rawat', dept: 'PHD', rank: Rank.HOD, scope: 'AUTHORITY' },
  { email: 'cso.z1.phd@noidaauthority.in', name: 'Rajeev Bhati', dept: 'PHD', rank: Rank.ZONAL_OFFICER, scope: 'Z1' },
  { email: 'cso.z2.phd@noidaauthority.in', name: 'Neelam Tyagi', dept: 'PHD', rank: Rank.ZONAL_OFFICER, scope: 'Z2' },
  { email: 'cso.z3.phd@noidaauthority.in', name: 'Mahesh Nagar', dept: 'PHD', rank: Rank.ZONAL_OFFICER, scope: 'Z3' },
  { email: 'so.wc1.phd@noidaauthority.in', name: 'Anil Kumar Sharma', dept: 'PHD', rank: Rank.CIRCLE_OFFICER, scope: 'WC1' },
  { email: 'so.wc2.phd@noidaauthority.in', name: 'Poonam Chaudhary', dept: 'PHD', rank: Rank.CIRCLE_OFFICER, scope: 'WC2' },
  { email: 'so.wc3.phd@noidaauthority.in', name: 'Devendra Singh', dept: 'PHD', rank: Rank.CIRCLE_OFFICER, scope: 'WC3' },
  { email: 'so.wc4.phd@noidaauthority.in', name: 'Kavita Solanki', dept: 'PHD', rank: Rank.CIRCLE_OFFICER, scope: 'WC4' },
  { email: 'so.wc5.phd@noidaauthority.in', name: 'Ramesh Chand', dept: 'PHD', rank: Rank.CIRCLE_OFFICER, scope: 'WC5' },
  { email: 'so.wc6.phd@noidaauthority.in', name: 'Sarita Verma', dept: 'PHD', rank: Rank.CIRCLE_OFFICER, scope: 'WC6' },

  // Electrical
  { email: 'gm.emd@noidaauthority.in', name: 'Vikas Malhotra', dept: 'EMD', rank: Rank.HOD, scope: 'AUTHORITY' },
  { email: 'se.z1.emd@noidaauthority.in', name: 'Harpal Yadav', dept: 'EMD', rank: Rank.ZONAL_OFFICER, scope: 'Z1' },
  { email: 'se.z2.emd@noidaauthority.in', name: 'Shalini Gupta', dept: 'EMD', rank: Rank.ZONAL_OFFICER, scope: 'Z2' },
  { email: 'se.z3.emd@noidaauthority.in', name: 'Om Prakash', dept: 'EMD', rank: Rank.ZONAL_OFFICER, scope: 'Z3' },
  { email: 'ee.wc1.emd@noidaauthority.in', name: 'Sandeep Rana', dept: 'EMD', rank: Rank.CIRCLE_OFFICER, scope: 'WC1' },
  { email: 'ee.wc2.emd@noidaauthority.in', name: 'Meenakshi Jain', dept: 'EMD', rank: Rank.CIRCLE_OFFICER, scope: 'WC2' },
  { email: 'ee.wc3.emd@noidaauthority.in', name: 'Arvind Baisoya', dept: 'EMD', rank: Rank.CIRCLE_OFFICER, scope: 'WC3' },
  { email: 'ee.wc4.emd@noidaauthority.in', name: 'Rekha Pandey', dept: 'EMD', rank: Rank.CIRCLE_OFFICER, scope: 'WC4' },
  { email: 'ee.wc5.emd@noidaauthority.in', name: 'Jitendra Sisodia', dept: 'EMD', rank: Rank.CIRCLE_OFFICER, scope: 'WC5' },
  { email: 'ee.wc6.emd@noidaauthority.in', name: 'Anuradha Mishra', dept: 'EMD', rank: Rank.CIRCLE_OFFICER, scope: 'WC6' },

  // Civil
  { email: 'gm.civil@noidaauthority.in', name: 'Prakash Chandra Dubey', dept: 'CIVIL', rank: Rank.HOD, scope: 'AUTHORITY' },
  { email: 'se.z1.civil@noidaauthority.in', name: 'Gyan Prakash', dept: 'CIVIL', rank: Rank.ZONAL_OFFICER, scope: 'Z1' },
  { email: 'se.z2.civil@noidaauthority.in', name: 'Ritu Bansal', dept: 'CIVIL', rank: Rank.ZONAL_OFFICER, scope: 'Z2' },
  { email: 'se.z3.civil@noidaauthority.in', name: 'Balbir Singh', dept: 'CIVIL', rank: Rank.ZONAL_OFFICER, scope: 'Z3' },
  { email: 'ee.wc1.civil@noidaauthority.in', name: 'Naveen Chauhan', dept: 'CIVIL', rank: Rank.CIRCLE_OFFICER, scope: 'WC1' },
  { email: 'ee.wc2.civil@noidaauthority.in', name: 'Sudha Rani', dept: 'CIVIL', rank: Rank.CIRCLE_OFFICER, scope: 'WC2' },
  { email: 'ee.wc3.civil@noidaauthority.in', name: 'Mukesh Tomar', dept: 'CIVIL', rank: Rank.CIRCLE_OFFICER, scope: 'WC3' },
  { email: 'ee.wc4.civil@noidaauthority.in', name: 'Preeti Saxena', dept: 'CIVIL', rank: Rank.CIRCLE_OFFICER, scope: 'WC4' },
  { email: 'ee.wc5.civil@noidaauthority.in', name: 'Satish Kumar', dept: 'CIVIL', rank: Rank.CIRCLE_OFFICER, scope: 'WC5' },
  { email: 'ee.wc6.civil@noidaauthority.in', name: 'Nisha Adhikari', dept: 'CIVIL', rank: Rank.CIRCLE_OFFICER, scope: 'WC6' },
]

/**
 * Names for generated sector staff.
 *
 * Combined rather than listed: 213 posts need more names than a hand-written
 * list sensibly holds, and reusing one across two ranks makes the org chart
 * look broken to anyone reading it.
 */
const FIRST_NAMES = [
  'Rakesh', 'Sunil', 'Imran', 'Anita', 'Mohan', 'Farida', 'Ravi', 'Deepak',
  'Sneha', 'Ajay', 'Manju', 'Pawan', 'Geeta', 'Vinod', 'Shabnam', 'Dinesh',
  'Rupali', 'Yogesh', 'Kiran', 'Hemant', 'Suresh', 'Nidhi', 'Tarun', 'Asha',
  'Irfan', 'Lalita', 'Girish', 'Babita', 'Naresh', 'Pooja', 'Krishan', 'Seema',
  'Rajpal', 'Usha', 'Amit', 'Bhupendra', 'Savita', 'Manisha', 'Jagdish', 'Kamlesh',
]

const LAST_NAMES = [
  'Verma', 'Yadav', 'Sheikh', 'Deshmukh', 'Pal', 'Khan', 'Malviya', 'Nair',
  'Chouhan', 'Bhardwaj', 'Rathi', 'Sharma', 'Kashyap', 'Panwar', 'Nagar',
  'Bisht', 'Chandola', 'Gurjar', 'Tomar', 'Dagar', 'Baghel', 'Sisodia',
  'Kushwaha', 'Prajapati', 'Rawat', 'Bhati', 'Tyagi', 'Solanki', 'Chaudhary',
  'Saxena',
]

const CITIZENS = [
  { email: 'citizen@example.com', name: 'Meera Joshi', sector: 62 },
  { email: 'citizen2@example.com', name: 'Arjun Rao', sector: 15 },
  { email: 'citizen3@example.com', name: 'Fatima Ansari', sector: 5 },
  { email: 'citizen4@example.com', name: 'Vikram Singh', sector: 137 },
  { email: 'citizen5@example.com', name: 'Lakshmi Iyer', sector: 22 },
  { email: 'citizen6@example.com', name: 'Rohit Bhardwaj', sector: 8 },
  { email: 'citizen7@example.com', name: 'Anjali Mehta', sector: 18 },
]

const CONTRACTORS = [
  { code: 'CTR-001', name: 'Yamuna Infra Projects Pvt Ltd', isBlacklisted: false },
  { code: 'CTR-002', name: 'Hindon Constructions', isBlacklisted: false },
  { code: 'CTR-003', name: 'Okhla Civil Works', isBlacklisted: true },
]

/**
 * Per-sector service quality.
 *
 * Deliberately uneven — Sector 5 (Harola, a dense older settlement) is the
 * problem area, so GRIE has something real to surface instead of a flat city.
 */
const SECTOR_PROFILE: Record<number, { count: number; resolveRate: number; lateRate: number; escalateRate: number }> = {
  5: { count: 24, resolveRate: 0.28, lateRate: 0.78, escalateRate: 0.45 },
  8: { count: 15, resolveRate: 0.45, lateRate: 0.6, escalateRate: 0.25 },
  9: { count: 11, resolveRate: 0.55, lateRate: 0.45, escalateRate: 0.15 },
  62: { count: 14, resolveRate: 0.78, lateRate: 0.2, escalateRate: 0.05 },
  63: { count: 10, resolveRate: 0.8, lateRate: 0.18, escalateRate: 0.05 },
  18: { count: 13, resolveRate: 0.62, lateRate: 0.35, escalateRate: 0.12 },
  15: { count: 8, resolveRate: 0.85, lateRate: 0.12, escalateRate: 0.02 },
  22: { count: 7, resolveRate: 0.82, lateRate: 0.15, escalateRate: 0.03 },
  12: { count: 6, resolveRate: 0.85, lateRate: 0.1, escalateRate: 0 },
  137: { count: 9, resolveRate: 0.75, lateRate: 0.22, escalateRate: 0.06 },
  128: { count: 5, resolveRate: 0.85, lateRate: 0.1, escalateRate: 0 },
  1: { count: 8, resolveRate: 0.6, lateRate: 0.4, escalateRate: 0.14 },
  10: { count: 6, resolveRate: 0.7, lateRate: 0.3, escalateRate: 0.08 },
  11: { count: 5, resolveRate: 0.78, lateRate: 0.2, escalateRate: 0.04 },
  27: { count: 6, resolveRate: 0.8, lateRate: 0.18, escalateRate: 0.03 },
  29: { count: 4, resolveRate: 0.85, lateRate: 0.12, escalateRate: 0 },
  71: { count: 7, resolveRate: 0.76, lateRate: 0.24, escalateRate: 0.06 },
  168: { count: 3, resolveRate: 0.9, lateRate: 0.08, escalateRate: 0 },
}

async function main() {
  console.log('Seeding DRISHTI-G — NOIDA Authority\n')
  const hashedPassword = await bcrypt.hash(PASSWORD, 10)

  // --- Geography -------------------------------------------------------------
  const zones = new Map<string, number>()
  for (const z of ZONES) {
    const row = await prisma.zone.upsert({ where: { code: z.code }, update: z, create: z })
    zones.set(z.code, row.id)
  }

  const circles = new Map<string, number>()
  for (const c of CIRCLES) {
    const data = { code: c.code, name: c.name, zoneId: zones.get(c.zone)! }
    const row = await prisma.circle.upsert({ where: { code: c.code }, update: data, create: data })
    circles.set(c.code, row.id)
  }

  const sectors = new Map<number, number>()
  for (const s of SECTORS) {
    const data = {
      number: s.number,
      name: s.name,
      circleId: circles.get(s.circle)!,
      population: s.population,
      centroidLat: s.lat,
      centroidLon: s.lon,
    }
    const row = await prisma.sector.upsert({ where: { number: s.number }, update: data, create: data })
    sectors.set(s.number, row.id)
  }
  console.log(`  ${ZONES.length} zones, ${CIRCLES.length} work circles, ${SECTORS.length} sectors`)

  // --- Departments and designations ------------------------------------------
  const departments = new Map<string, number>()
  for (const d of DEPARTMENTS) {
    const { designations, ...rest } = d
    const row = await prisma.department.upsert({ where: { code: d.code }, update: rest, create: rest })
    departments.set(d.code, row.id)

    if (designations) {
      for (const [rank, [title, shortTitle]] of Object.entries(designations)) {
        await prisma.designation.upsert({
          where: { departmentId_rank: { departmentId: row.id, rank: rank as Rank } },
          update: { title, shortTitle },
          create: { departmentId: row.id, rank: rank as Rank, title, shortTitle },
        })
      }
    }
  }
  const activeDepts = DEPARTMENTS.filter((d) => d.status === DepartmentStatus.ACTIVE)
  console.log(`  ${activeDepts.length} active departments, ${DEPARTMENTS.length - activeDepts.length} on the roadmap`)

  const categories = new Map<string, number>()
  for (const c of CATEGORIES) {
    const data = {
      code: c.code,
      name: c.name,
      nameHi: c.nameHi,
      departmentId: departments.get(c.dept)!,
      defaultSlaHours: c.sla,
      keywords: c.keywords,
      icon: c.icon,
      trade: c.trade,
    }
    const row = await prisma.complaintCategory.upsert({ where: { code: c.code }, update: data, create: data })
    categories.set(c.code, row.id)
  }
  console.log(`  ${CATEGORIES.length} complaint categories`)

  // --- People ----------------------------------------------------------------
  let employeeSeq = 1000
  const nextEmployeeCode = (prefix: string) => `${prefix}-${++employeeSeq}`

  async function createStaff(params: {
    email: string
    name: string
    rank: Rank
    departmentId: number | null
    level: JurisdictionLevel
    zoneId?: number | null
    circleId?: number | null
    sectorId?: number | null
    trade?: Trade | null
    designationTitle: string
    employeePrefix: string
  }): Promise<number> {
    const user = await prisma.user.upsert({
      where: { email: params.email },
      update: { rank: params.rank },
      create: {
        email: params.email,
        hashedPassword,
        fullName: params.name,
        rank: params.rank,
      },
    })

    const existing = await prisma.posting.findFirst({ where: { userId: user.id, endedAt: null } })
    if (!existing) {
      await prisma.posting.create({
        data: {
          userId: user.id,
          departmentId: params.departmentId,
          rank: params.rank,
          level: params.level,
          zoneId: params.zoneId ?? null,
          circleId: params.circleId ?? null,
          sectorId: params.sectorId ?? null,
          trade: params.trade ?? null,
          designationTitle: params.designationTitle,
          employeeCode: nextEmployeeCode(params.employeePrefix),
        },
      })
    }
    return user.id
  }

  // Apex
  await createStaff({
    email: 'admin@drishti.gov.in',
    name: 'System Administrator',
    rank: Rank.SUPER_ADMIN,
    departmentId: null,
    level: JurisdictionLevel.AUTHORITY,
    designationTitle: 'System Administrator',
    employeePrefix: 'SYS',
  })

  await createStaff({
    email: 'ceo@noidaauthority.in',
    name: 'Dr. Lokesh Maheshwari, IAS',
    rank: Rank.CEO,
    departmentId: null,
    level: JurisdictionLevel.AUTHORITY,
    designationTitle: 'Chief Executive Officer',
    employeePrefix: 'CEO',
  })

  // Senior staff
  for (const s of SENIOR_STAFF) {
    const deptId = departments.get(s.dept)!
    const designation = await prisma.designation.findUnique({
      where: { departmentId_rank: { departmentId: deptId, rank: s.rank } },
    })
    await createStaff({
      email: s.email,
      name: s.name,
      rank: s.rank,
      departmentId: deptId,
      level:
        s.scope === 'AUTHORITY'
          ? JurisdictionLevel.AUTHORITY
          : s.scope.startsWith('Z')
            ? JurisdictionLevel.ZONE
            : JurisdictionLevel.CIRCLE,
      zoneId: s.scope.startsWith('Z') ? zones.get(s.scope) : null,
      circleId: s.scope.startsWith('WC') ? circles.get(s.scope) : null,
      designationTitle: designation?.title ?? s.rank,
      employeePrefix: s.dept,
    })
  }

  // Sector staff: one Section Officer plus two or three workers per sector per
  // active department. This is what makes the demo feel like a real authority —
  // a complaint in any sector has someone accountable for it.
  // Walk first and last names at co-prime strides so pairings stay unique for
  // far longer than either list alone.
  let nameIndex = 0
  const nextName = () => {
    const first = FIRST_NAMES[nameIndex % FIRST_NAMES.length]!
    const last = LAST_NAMES[(nameIndex * 7) % LAST_NAMES.length]!
    nameIndex++
    return `${first} ${last}`
  }

  let officerCount = 0
  let workerCount = 0

  for (const dept of activeDepts) {
    const deptId = departments.get(dept.code)!
    const soDesignation = await prisma.designation.findUnique({
      where: { departmentId_rank: { departmentId: deptId, rank: Rank.SECTION_OFFICER } },
    })
    const fwDesignation = await prisma.designation.findUnique({
      where: { departmentId_rank: { departmentId: deptId, rank: Rank.FIELD_WORKER } },
    })
    const trade =
      dept.code === 'PHD' ? Trade.SAFAI_KARAMCHARI : dept.code === 'EMD' ? Trade.LINEMAN : Trade.BELDAR

    for (const s of SECTORS) {
      const sectorId = sectors.get(s.number)!
      const slug = dept.code.toLowerCase()

      await createStaff({
        email: `je.s${s.number}.${slug}@noidaauthority.in`,
        name: nextName(),
        rank: Rank.SECTION_OFFICER,
        departmentId: deptId,
        level: JurisdictionLevel.SECTOR,
        sectorId,
        designationTitle: soDesignation?.title ?? 'Section Officer',
        employeePrefix: dept.code,
      })
      officerCount++

      // Busier sectors get a larger crew, as they would in practice.
      const crewSize = (SECTOR_PROFILE[s.number]?.count ?? 5) > 12 ? 3 : 2
      for (let i = 1; i <= crewSize; i++) {
        await createStaff({
          email: `worker${i}.s${s.number}.${slug}@noidaauthority.in`,
          name: nextName(),
          rank: Rank.FIELD_WORKER,
          departmentId: deptId,
          level: JurisdictionLevel.SECTOR,
          sectorId,
          trade,
          designationTitle: fwDesignation?.title ?? 'Field Worker',
          employeePrefix: 'W',
        })
        workerCount++
      }
    }
  }

  const citizenIds: Array<{ id: number; sectorId: number }> = []
  for (const c of CITIZENS) {
    const sectorId = sectors.get(c.sector)!
    const user = await prisma.user.upsert({
      where: { email: c.email },
      update: {},
      create: {
        email: c.email,
        hashedPassword,
        fullName: c.name,
        rank: Rank.CITIZEN,
        homeSectorId: sectorId,
      },
    })
    citizenIds.push({ id: user.id, sectorId })
  }

  console.log(
    `  1 super admin, 1 CEO, ${SENIOR_STAFF.length} senior officers, ${officerCount} section officers, ${workerCount} field workers, ${CITIZENS.length} citizens`,
  )

  // --- Contractors and projects ----------------------------------------------
  const contractorIds = new Map<string, number>()
  for (const c of CONTRACTORS) {
    const row = await prisma.contractor.upsert({ where: { code: c.code }, update: c, create: c })
    contractorIds.set(c.code, row.id)
  }

  const PROJECTS = [
    { code: 'PRJ-001', name: 'Sector 62 Road Resurfacing', contractor: 'CTR-001', dept: 'CIVIL', sector: 62, allocated: 45_00_000, spent: 42_00_000, plannedDays: 90, actualDays: 88, inspections: [true, true, true] },
    { code: 'PRJ-002', name: 'Harola Drainage Upgrade (Sector 5)', contractor: 'CTR-003', dept: 'CIVIL', sector: 5, allocated: 80_00_000, spent: 1_16_00_000, plannedDays: 120, actualDays: 260, inspections: [false, false, true, false] },
    { code: 'PRJ-003', name: 'Sector 18 LED Streetlight Rollout', contractor: 'CTR-002', dept: 'EMD', sector: 18, allocated: 22_00_000, spent: 24_50_000, plannedDays: 60, actualDays: 95, inspections: [true, false, true] },
    { code: 'PRJ-004', name: 'Sector 137 Sanitation Vehicle Fleet', contractor: 'CTR-001', dept: 'PHD', sector: 137, allocated: 60_00_000, spent: 58_00_000, plannedDays: 150, actualDays: 150, inspections: [true, true] },
    { code: 'PRJ-005', name: 'Sector 8 Footpath Reconstruction', contractor: 'CTR-003', dept: 'CIVIL', sector: 8, allocated: 30_00_000, spent: 39_00_000, plannedDays: 75, actualDays: 168, inspections: [false, true, false] },
  ]

  const allStaffIds = (
    await prisma.user.findMany({ where: { rank: Rank.SECTION_OFFICER }, select: { id: true }, take: 50 })
  ).map((u) => u.id)

  for (const spec of PROJECTS) {
    const start = new Date(Date.now() - (spec.actualDays + 40) * DAY)
    const data = {
      code: spec.code,
      name: spec.name,
      contractorId: contractorIds.get(spec.contractor)!,
      departmentId: departments.get(spec.dept)!,
      sectorId: sectors.get(spec.sector)!,
      budgetAllocated: spec.allocated,
      budgetSpent: spec.spent,
      plannedStart: start,
      plannedEnd: new Date(start.getTime() + spec.plannedDays * DAY),
      actualStart: start,
      actualEnd: new Date(start.getTime() + spec.actualDays * DAY),
      completionPct: 100,
    }
    const project = await prisma.project.upsert({ where: { code: spec.code }, update: data, create: data })

    if ((await prisma.inspection.count({ where: { projectId: project.id } })) === 0) {
      await prisma.inspection.createMany({
        data: spec.inspections.map((passed, i) => ({
          projectId: project.id,
          inspectorId: allStaffIds.length > 0 ? pick(allStaffIds) : null,
          scheduledFor: new Date(start.getTime() + (i + 1) * 30 * DAY),
          conductedOn: new Date(start.getTime() + (i + 1) * 30 * DAY),
          passed,
          score: passed ? Math.round(between(72, 95)) : Math.round(between(28, 55)),
          remarks: passed ? 'Work meets specification.' : 'Deviations from specification found on site.',
        })),
      })
    }
  }
  console.log(`  ${CONTRACTORS.length} contractors, ${PROJECTS.length} projects with inspections`)

  // --- Complaint history -----------------------------------------------------
  if ((await prisma.complaint.count()) > 0) {
    console.log('\n  Complaints already exist — skipping history generation.')
  } else {
    let created = 0
    let escalated = 0

    for (const sectorSpec of SECTORS) {
      const profile = SECTOR_PROFILE[sectorSpec.number]
      if (!profile) continue
      const sectorId = sectors.get(sectorSpec.number)!

      for (let i = 0; i < profile.count; i++) {
        const categorySpec = pick(CATEGORIES)
        const template = pick(TEMPLATES[categorySpec.code]!)
        const categoryId = categories.get(categorySpec.code)!
        const departmentId = departments.get(categorySpec.dept)!

        // How much of a sector's load is fresh follows from how well it is run:
        // a sector that closes work keeps only recent complaints in hand, while a
        // neglected one accumulates a backlog. So freshness tracks resolveRate
        // rather than being a flat constant — which also stops every seeded
        // complaint from being overdue and leaving Section Officer desks empty.
        const isFresh = random() < profile.resolveRate * 0.6
        const ageDays = isFresh
          ? between(0.05, categorySpec.sla / 24 * 0.6)
          : between(4, 70)
        const createdAt = new Date(Date.now() - ageDays * DAY)
        const slaDueAt = new Date(createdAt.getTime() + categorySpec.sla * 3_600_000)

        const officerPosting = await prisma.posting.findFirst({
          where: { departmentId, sectorId, rank: Rank.SECTION_OFFICER, endedAt: null },
        })
        const workerPosting = await prisma.posting.findFirst({
          where: { departmentId, sectorId, rank: Rank.FIELD_WORKER, endedAt: null },
        })

        // A complaint filed hours ago has not had time to be resolved, go late,
        // or be escalated — treating it as if it had would make the generated
        // history incoherent.
        const isResolved = !isFresh && random() < profile.resolveRate
        const isLate = random() < profile.lateRate
        const wasEscalated = !isFresh && !isResolved && random() < profile.escalateRate

        const resolvedAt = isResolved
          ? new Date(
              slaDueAt.getTime() +
                (isLate ? between(1, 12) * DAY : -between(0.1, 0.8) * categorySpec.sla * 3_600_000),
            )
          : null

        let status: ComplaintStatus
        if (isResolved) {
          status = random() < 0.6 ? ComplaintStatus.CLOSED : ComplaintStatus.RESOLVED
        } else if (isFresh) {
          // Fresh work sits with the officer or has just been allotted — it is
          // what a Section Officer opens their desk to.
          status = random() < 0.55 ? ComplaintStatus.ASSIGNED : ComplaintStatus.IN_PROGRESS
        } else if (random() < 0.3) {
          status = ComplaintStatus.AWAITING_VERIFICATION
        } else if (random() < 0.6) {
          status = ComplaintStatus.IN_PROGRESS
        } else {
          status = ComplaintStatus.ASSIGNED
        }

        const citizen = pick(citizenIds)
        const usesWorker =
          status === ComplaintStatus.IN_PROGRESS ||
          status === ComplaintStatus.AWAITING_VERIFICATION ||
          isResolved

        const complaint = await prisma.complaint.create({
          data: {
            referenceNo: 'PENDING',
            citizenId: citizen.id,
            title: template.title,
            description: template.description,
            categoryId,
            departmentId,
            sectorId,
            assignedOfficerId: officerPosting?.userId ?? null,
            assignedWorkerId: usesWorker ? (workerPosting?.userId ?? null) : null,
            status,
            priority: wasEscalated ? Priority.HIGH : profile.count > 20 ? Priority.HIGH : Priority.MEDIUM,
            escalationLevel: wasEscalated ? 1 : 0,
            // Jitter around the centroid so map pins are not stacked.
            latitude: sectorSpec.lat + between(-0.004, 0.004),
            longitude: sectorSpec.lon + between(-0.004, 0.004),
            slaDueAt,
            resolvedAt,
            closedAt: status === ComplaintStatus.CLOSED ? resolvedAt : null,
            feedbackRating:
              status === ComplaintStatus.CLOSED && random() < 0.5 ? Math.ceil(between(2, 5)) : null,
            createdAt,
          },
        })

        await prisma.complaint.update({
          where: { id: complaint.id },
          data: { referenceNo: `DG-${createdAt.getFullYear()}-${String(complaint.id).padStart(6, '0')}` },
        })

        // A believable trail, so the timeline is not empty on seeded data.
        const history: Array<{ from: ComplaintStatus | null; to: ComplaintStatus; at: Date; note: string; actorId: number | null }> = [
          {
            from: ComplaintStatus.SUBMITTED,
            to: ComplaintStatus.ASSIGNED,
            at: createdAt,
            note: 'Routed by GCCE from the complaint text and location.',
            actorId: null,
          },
        ]
        if (usesWorker && workerPosting) {
          history.push({
            from: ComplaintStatus.ASSIGNED,
            to: ComplaintStatus.IN_PROGRESS,
            at: new Date(createdAt.getTime() + 0.3 * DAY),
            note: 'Work allotted to the sector crew and started on site.',
            actorId: officerPosting?.userId ?? null,
          })
        }
        if (isResolved && resolvedAt) {
          history.push({
            from: ComplaintStatus.IN_PROGRESS,
            to: ComplaintStatus.AWAITING_VERIFICATION,
            at: new Date(resolvedAt.getTime() - 0.2 * DAY),
            note: 'Crew reported the work complete and submitted a photograph.',
            actorId: workerPosting?.userId ?? null,
          })
          history.push({
            from: ComplaintStatus.AWAITING_VERIFICATION,
            to: ComplaintStatus.RESOLVED,
            at: resolvedAt,
            note: 'Inspected on site and accepted.',
            actorId: officerPosting?.userId ?? null,
          })
          if (status === ComplaintStatus.CLOSED) {
            history.push({
              from: ComplaintStatus.RESOLVED,
              to: ComplaintStatus.CLOSED,
              at: resolvedAt,
              note: 'Verified and closed at circle level.',
              actorId: null,
            })
          }
        }

        await prisma.complaintStatusHistory.createMany({
          data: history.map((h) => ({
            complaintId: complaint.id,
            fromStatus: h.from,
            toStatus: h.to,
            actorId: h.actorId,
            note: h.note,
            createdAt: h.at,
          })),
        })

        if (wasEscalated) {
          const circleOfficer = await prisma.posting.findFirst({
            where: {
              departmentId,
              rank: Rank.CIRCLE_OFFICER,
              circle: { sectors: { some: { id: sectorId } } },
              endedAt: null,
            },
          })
          if (circleOfficer) {
            const hoursOverdue = Math.round(between(6, 96))
            await prisma.escalation.create({
              data: {
                complaintId: complaint.id,
                fromRank: Rank.SECTION_OFFICER,
                toRank: Rank.CIRCLE_OFFICER,
                toUserId: circleOfficer.userId,
                reason: `Unresolved ${hoursOverdue} hours past its Section Officer deadline.`,
                hoursOverdue,
                createdAt: new Date(slaDueAt.getTime() + hoursOverdue * 3_600_000),
              },
            })
            await prisma.complaint.update({
              where: { id: complaint.id },
              data: { assignedOfficerId: circleOfficer.userId },
            })
            escalated++
          }
        }

        created++
      }
    }
    console.log(`  ${created} complaints with history, ${escalated} of them escalated up the chain`)
  }

  // --- Escalation ------------------------------------------------------------
  // Run before scoring, not after. Escalation is one of GRIE's five signals, so
  // a database seeded with overdue complaints that have not yet been escalated
  // is internally inconsistent — the scores would understate exactly the areas
  // that are failing worst.
  const { runEscalationSweep } = await import('../src/services/escalation.js')
  const sweep = await runEscalationSweep()
  console.log(`  escalation sweep: ${sweep.escalated.length} of ${sweep.checked} overdue complaints raised up the chain`)

  // --- GRIE ------------------------------------------------------------------
  const { recomputeAll } = await import('../src/services/riskSignals.js')
  const counts = await recomputeAll()
  console.log(
    `  GRIE scored ${counts.sectors} sectors, ${counts.circles} circles, ${counts.zones} zones, ${counts.departments} departments, ${counts.projects} projects, ${counts.contractors} contractors`,
  )

  const flags = await prisma.riskFlag.findMany({ where: { status: 'PENDING' }, orderBy: { score: 'desc' } })
  if (flags.length > 0) {
    console.log(`\n  ${flags.length} entities flagged for review:`)
    for (const f of flags.slice(0, 12)) {
      console.log(`    ${f.band.padEnd(8)} ${String(f.score).padStart(6)}  ${f.entityLabel}`)
    }
  }

  console.log(`\nDemo accounts — password: ${PASSWORD}`)
  console.log('  admin@drishti.gov.in            Super Admin — every department, every zone')
  console.log('  ceo@noidaauthority.in           CEO — authority-wide oversight')
  console.log('  gm.phd@noidaauthority.in        General Manager, Public Health')
  console.log('  so.wc5.phd@noidaauthority.in    Sanitary Officer, Work Circle 5')
  console.log('  je.s5.phd@noidaauthority.in     Sanitary Inspector, Sector 5 (the busy one)')
  console.log('  worker1.s5.phd@noidaauthority.in  Safai Karamchari, Sector 5')
  console.log('  citizen@example.com             Citizen, Sector 62')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
