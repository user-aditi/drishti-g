/**
 * Seeds a demo city with enough lived-in history that GRIE has real signal to
 * score and the dashboards are not empty on first load.
 *
 * Idempotent: everything upserts on a natural key, so re-running does not
 * duplicate. Complaints are only generated when there are none, since they
 * carry backdated timestamps that should not be regenerated on top of each other.
 */
import { ComplaintStatus, PrismaClient, Priority, UserRole } from '@prisma/client'
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

const DEPARTMENTS = [
  { code: 'PWD', name: 'Public Works', description: 'Roads, footpaths, drains and civil works' },
  { code: 'ELEC', name: 'Electrical', description: 'Street lighting and municipal electrical assets' },
  { code: 'SWM', name: 'Solid Waste Management', description: 'Garbage collection and sanitation' },
  { code: 'WATER', name: 'Water Supply', description: 'Water lines, leaks and supply quality' },
  { code: 'HEALTH', name: 'Public Health', description: 'Sanitation inspections and public health' },
]

// Real Bhopal coordinates, so GCCE's nearest-centroid routing works on
// believable distances rather than points on a grid.
const WARDS = [
  { wardNumber: 1, name: 'Shahpura', zone: 'South', population: 48000, centroidLat: 23.1955, centroidLon: 77.431 },
  { wardNumber: 2, name: 'Arera Colony', zone: 'South', population: 52000, centroidLat: 23.212, centroidLon: 77.429 },
  { wardNumber: 3, name: 'MP Nagar', zone: 'Central', population: 61000, centroidLat: 23.233, centroidLon: 77.434 },
  { wardNumber: 4, name: 'Kolar', zone: 'South-East', population: 74000, centroidLat: 23.164, centroidLon: 77.437 },
  { wardNumber: 5, name: 'Old City', zone: 'North', population: 68000, centroidLat: 23.2599, centroidLon: 77.4126 },
  { wardNumber: 6, name: 'Bairagarh', zone: 'West', population: 39000, centroidLat: 23.279, centroidLon: 77.335 },
]

// Hinglish keywords are here from day one because that is how complaints
// actually arrive; GCCE's matcher is what reads them.
const CATEGORIES = [
  { code: 'POTHOLE', name: 'Pothole / Damaged Road', dept: 'PWD', sla: 72, icon: '🛣️', keywords: 'pothole,gaddha,road,sadak,damaged road,broken road,tar,gaddhe' },
  { code: 'STREETLIGHT', name: 'Streetlight Not Working', dept: 'ELEC', sla: 48, icon: '💡', keywords: 'streetlight,street light,light,batti,lamp,pole,dark,andhera,bijli' },
  { code: 'GARBAGE', name: 'Garbage Not Collected', dept: 'SWM', sla: 24, icon: '🗑️', keywords: 'garbage,kachra,waste,trash,dustbin,rubbish,dump,safai,kooda' },
  { code: 'DRAIN', name: 'Blocked Drain / Sewage', dept: 'PWD', sla: 48, icon: '🌊', keywords: 'drain,nali,sewage,overflow,blockage,gutter,choked,nalla' },
  { code: 'WATER_LEAK', name: 'Water Leakage', dept: 'WATER', sla: 24, icon: '🚰', keywords: 'water,pani,leak,leakage,pipeline,burst,tap,supply,nal' },
  { code: 'MOSQUITO', name: 'Mosquito / Sanitation Hazard', dept: 'HEALTH', sla: 96, icon: '🦟', keywords: 'mosquito,machhar,breeding,stagnant,dengue,sanitation,hygiene' },
]

const OFFICIALS = [
  { email: 'pwd.ward1@drishti.gov.in', name: 'Rakesh Verma', dept: 'PWD', ward: 1 },
  { email: 'pwd.ward3@drishti.gov.in', name: 'Sunil Yadav', dept: 'PWD', ward: 3 },
  { email: 'pwd.ward5@drishti.gov.in', name: 'Imran Sheikh', dept: 'PWD', ward: 5 },
  { email: 'elec.ward1@drishti.gov.in', name: 'Anita Deshmukh', dept: 'ELEC', ward: 1 },
  { email: 'elec.ward2@drishti.gov.in', name: 'Mohan Patil', dept: 'ELEC', ward: 2 },
  { email: 'elec.ward5@drishti.gov.in', name: 'Sanjay Kushwaha', dept: 'ELEC', ward: 5 },
  { email: 'swm.ward2@drishti.gov.in', name: 'Farida Khan', dept: 'SWM', ward: 2 },
  { email: 'swm.ward5@drishti.gov.in', name: 'Ravi Malviya', dept: 'SWM', ward: 5 },
  { email: 'water.ward3@drishti.gov.in', name: 'Deepak Nair', dept: 'WATER', ward: 3 },
  { email: 'health.ward4@drishti.gov.in', name: 'Sneha Chouhan', dept: 'HEALTH', ward: 4 },
]

const CITIZENS = [
  { email: 'citizen@example.com', name: 'Meera Joshi', ward: 1 },
  { email: 'citizen2@example.com', name: 'Arjun Rao', ward: 3 },
  { email: 'citizen3@example.com', name: 'Fatima Ansari', ward: 5 },
  { email: 'citizen4@example.com', name: 'Vikram Singh', ward: 2 },
  { email: 'citizen5@example.com', name: 'Lakshmi Iyer', ward: 4 },
]

const CONTRACTORS = [
  { code: 'CTR-001', name: 'Narmada Infra Pvt Ltd', isBlacklisted: false },
  { code: 'CTR-002', name: 'Vindhya Constructions', isBlacklisted: false },
  { code: 'CTR-003', name: 'Satpura Civil Works', isBlacklisted: true },
]

/** Complaint templates per category, mixing English and Hinglish phrasing. */
const TEMPLATES: Record<string, Array<{ title: string; description: string }>> = {
  POTHOLE: [
    { title: 'Large pothole near the market', description: 'There is a deep pothole on the main road near the vegetable market. Two-wheelers are skidding, especially at night.' },
    { title: 'Sadak par bade gaddhe hain', description: 'Humare colony ki sadak par bahut bade gaddhe ho gaye hain. Baarish ke baad paani bhar jata hai aur dikhta nahi hai.' },
    { title: 'Road surface broken after rain', description: 'The tar layer has completely come off after last week rain. The damaged road stretch is about thirty metres long.' },
  ],
  STREETLIGHT: [
    { title: 'Street light not working for a week', description: 'The street light outside our building has been off for over a week. The whole lane is dark after 7pm.' },
    { title: 'Batti kharab hai, poora andhera', description: 'Gali ki batti kaam nahi kar rahi. Raat ko andhera rehta hai aur ladkiyon ko darr lagta hai.' },
    { title: 'Multiple lamps out on main road', description: 'Four consecutive lamp poles on the main road are dark. Please check the connection at the pole junction.' },
  ],
  GARBAGE: [
    { title: 'Garbage not collected for four days', description: 'The dustbin at the corner is overflowing and waste is spilling onto the footpath. Dogs are scattering it around.' },
    { title: 'Kachra gaadi nahi aa rahi', description: 'Pichle ek hafte se kachra gaadi humare area mein nahi aayi hai. Poora kooda sadak par pada hai.' },
    { title: 'Illegal dumping behind the school', description: 'People are dumping construction waste behind the school compound. It has become a large rubbish pile.' },
  ],
  DRAIN: [
    { title: 'Drain blocked, sewage on the road', description: 'The drain near our gate is choked and sewage water is flowing onto the road. The smell is unbearable.' },
    { title: 'Nali choked hai, paani overflow', description: 'Nali poori tarah band ho gayi hai. Gandaa paani ghar ke saamne aa raha hai.' },
  ],
  WATER_LEAK: [
    { title: 'Pipeline leaking continuously', description: 'A water pipeline has burst near the park and clean water has been running to waste for two days.' },
    { title: 'Pani ka leakage road par', description: 'Main pipeline se pani leak ho raha hai. Bahut saara paani barbaad ho raha hai roz.' },
  ],
  MOSQUITO: [
    { title: 'Mosquito breeding in stagnant water', description: 'Stagnant water has collected in the empty plot and mosquito breeding has increased. Two dengue cases already in our lane.' },
    { title: 'Machhar bahut badh gaye hain', description: 'Khali plot mein paani jama hai aur machhar bahut ho gaye hain. Sanitation team ko bhejiye.' },
  ],
}

async function main() {
  console.log('Seeding DRISHTI-G...\n')
  const hashedPassword = await bcrypt.hash(PASSWORD, 10)

  // --- City structure --------------------------------------------------------
  const departments = new Map<string, number>()
  for (const d of DEPARTMENTS) {
    const row = await prisma.department.upsert({ where: { code: d.code }, update: d, create: d })
    departments.set(d.code, row.id)
  }

  const wards = new Map<number, number>()
  for (const w of WARDS) {
    const row = await prisma.ward.upsert({ where: { wardNumber: w.wardNumber }, update: w, create: w })
    wards.set(w.wardNumber, row.id)
  }

  const categories = new Map<string, number>()
  for (const c of CATEGORIES) {
    const data = {
      code: c.code,
      name: c.name,
      departmentId: departments.get(c.dept)!,
      defaultSlaHours: c.sla,
      keywords: c.keywords,
      icon: c.icon,
    }
    const row = await prisma.complaintCategory.upsert({ where: { code: c.code }, update: data, create: data })
    categories.set(c.code, row.id)
  }
  console.log(`  ${DEPARTMENTS.length} departments, ${WARDS.length} wards, ${CATEGORIES.length} categories`)

  // --- People ----------------------------------------------------------------
  await prisma.user.upsert({
    where: { email: 'admin@drishti.gov.in' },
    update: {},
    create: {
      email: 'admin@drishti.gov.in',
      hashedPassword,
      fullName: 'Priya Sharma',
      role: UserRole.ADMIN,
      phone: '9876543210',
    },
  })

  const officialIds: number[] = []
  for (const o of OFFICIALS) {
    const row = await prisma.user.upsert({
      where: { email: o.email },
      update: {},
      create: {
        email: o.email,
        hashedPassword,
        fullName: o.name,
        role: UserRole.FIELD_OFFICIAL,
        departmentId: departments.get(o.dept)!,
        wardId: wards.get(o.ward)!,
      },
    })
    officialIds.push(row.id)
  }

  const citizenIds: Array<{ id: number; wardId: number }> = []
  for (const c of CITIZENS) {
    const row = await prisma.user.upsert({
      where: { email: c.email },
      update: {},
      create: {
        email: c.email,
        hashedPassword,
        fullName: c.name,
        role: UserRole.CITIZEN,
        wardId: wards.get(c.ward)!,
      },
    })
    citizenIds.push({ id: row.id, wardId: wards.get(c.ward)! })
  }
  console.log(`  1 admin, ${OFFICIALS.length} field officials, ${CITIZENS.length} citizens`)

  // --- Contractors and projects ----------------------------------------------
  const contractorIds = new Map<string, number>()
  for (const c of CONTRACTORS) {
    const row = await prisma.contractor.upsert({ where: { code: c.code }, update: c, create: c })
    contractorIds.set(c.code, row.id)
  }

  const projectSpecs = [
    { code: 'PRJ-001', name: 'Shahpura Road Resurfacing', contractor: 'CTR-001', dept: 'PWD', ward: 1, allocated: 4_500_000, spent: 4_200_000, plannedDays: 90, actualDays: 88, inspections: [true, true, true] },
    { code: 'PRJ-002', name: 'Old City Drainage Upgrade', contractor: 'CTR-003', dept: 'PWD', ward: 5, allocated: 8_000_000, spent: 11_600_000, plannedDays: 120, actualDays: 260, inspections: [false, false, true, false] },
    { code: 'PRJ-003', name: 'MP Nagar LED Streetlight Rollout', contractor: 'CTR-002', dept: 'ELEC', ward: 3, allocated: 2_200_000, spent: 2_450_000, plannedDays: 60, actualDays: 95, inspections: [true, false, true] },
    { code: 'PRJ-004', name: 'Kolar Water Pipeline Extension', contractor: 'CTR-001', dept: 'WATER', ward: 4, allocated: 6_000_000, spent: 5_800_000, plannedDays: 150, actualDays: 150, inspections: [true, true] },
  ]

  for (const spec of projectSpecs) {
    const start = new Date(Date.now() - (spec.actualDays + 40) * DAY)
    const data = {
      code: spec.code,
      name: spec.name,
      contractorId: contractorIds.get(spec.contractor)!,
      departmentId: departments.get(spec.dept)!,
      wardId: wards.get(spec.ward)!,
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
          inspectorId: pick(officialIds),
          scheduledFor: new Date(start.getTime() + (i + 1) * 30 * DAY),
          conductedOn: new Date(start.getTime() + (i + 1) * 30 * DAY),
          passed,
          score: passed ? Math.round(between(72, 95)) : Math.round(between(28, 55)),
          remarks: passed ? 'Work meets specification.' : 'Deviations from specification found on site.',
        })),
      })
    }
  }
  console.log(`  ${CONTRACTORS.length} contractors, ${projectSpecs.length} projects with inspections`)

  // --- Complaint history -----------------------------------------------------
  if ((await prisma.complaint.count()) > 0) {
    console.log('\n  Complaints already exist — skipping history generation.')
  } else {
    // Wards are deliberately uneven: Old City (5) is the problem ward, so GRIE
    // has something meaningful to surface instead of a flat, uniform city.
    const wardWeights: Record<number, { count: number; resolveRate: number; lateRate: number }> = {
      1: { count: 9, resolveRate: 0.8, lateRate: 0.1 },
      2: { count: 7, resolveRate: 0.85, lateRate: 0.1 },
      3: { count: 12, resolveRate: 0.7, lateRate: 0.25 },
      4: { count: 6, resolveRate: 0.75, lateRate: 0.15 },
      5: { count: 26, resolveRate: 0.3, lateRate: 0.7 },
      6: { count: 5, resolveRate: 0.85, lateRate: 0.05 },
    }

    let created = 0

    for (const [wardNumber, profile] of Object.entries(wardWeights)) {
      const wardId = wards.get(Number(wardNumber))!
      const wardCitizens = citizenIds.filter((c) => c.wardId === wardId)
      const citizenPool = wardCitizens.length > 0 ? wardCitizens : citizenIds

      for (let i = 0; i < profile.count; i++) {
        const categoryCode = pick(CATEGORIES).code
        const template = pick(TEMPLATES[categoryCode]!)
        const categoryId = categories.get(categoryCode)!
        const spec = CATEGORIES.find((c) => c.code === categoryCode)!
        const departmentId = departments.get(spec.dept)!

        const ageDays = between(1, 75)
        const createdAt = new Date(Date.now() - ageDays * DAY)
        const slaDueAt = new Date(createdAt.getTime() + spec.sla * 3600_000)

        const official = await prisma.user.findFirst({
          where: { role: UserRole.FIELD_OFFICIAL, departmentId, wardId, isActive: true },
        })

        const isResolved = random() < profile.resolveRate
        const isLate = random() < profile.lateRate

        // A late resolution finishes after the deadline; an on-time one before.
        const resolvedAt = isResolved
          ? new Date(
              slaDueAt.getTime() + (isLate ? between(1, 10) * DAY : -between(0.1, 0.8) * spec.sla * 3600_000),
            )
          : null

        let status: ComplaintStatus
        if (isResolved) {
          status = random() < 0.6 ? ComplaintStatus.CLOSED : ComplaintStatus.RESOLVED
        } else if (!official) {
          status = ComplaintStatus.ROUTED
        } else {
          status = random() < 0.5 ? ComplaintStatus.ASSIGNED : ComplaintStatus.IN_PROGRESS
        }

        const ward = WARDS.find((w) => w.wardNumber === Number(wardNumber))!
        const citizen = pick(citizenPool)

        const complaint = await prisma.complaint.create({
          data: {
            referenceNo: 'PENDING',
            citizenId: citizen.id,
            title: template.title,
            description: template.description,
            categoryId,
            departmentId,
            wardId,
            assignedToId: official?.id ?? null,
            status,
            priority: profile.count > 20 ? Priority.HIGH : Priority.MEDIUM,
            // Jitter around the centroid so map pins are not all stacked.
            latitude: ward.centroidLat + between(-0.006, 0.006),
            longitude: ward.centroidLon + between(-0.006, 0.006),
            slaDueAt,
            resolvedAt,
            closedAt: status === ComplaintStatus.CLOSED ? resolvedAt : null,
            feedbackRating: status === ComplaintStatus.CLOSED && random() < 0.5 ? Math.ceil(between(2, 5)) : null,
            createdAt,
          },
        })

        await prisma.complaint.update({
          where: { id: complaint.id },
          data: { referenceNo: `DG-${createdAt.getFullYear()}-${String(complaint.id).padStart(6, '0')}` },
        })

        // A believable trail, so the timeline view is not empty on seeded data.
        const history: Array<{ from: ComplaintStatus | null; to: ComplaintStatus; at: Date; note: string }> = [
          { from: ComplaintStatus.SUBMITTED, to: official ? ComplaintStatus.ASSIGNED : ComplaintStatus.ROUTED, at: createdAt, note: 'Routed by GCCE from the complaint text and location.' },
        ]
        if (status === ComplaintStatus.IN_PROGRESS || isResolved) {
          history.push({ from: ComplaintStatus.ASSIGNED, to: ComplaintStatus.IN_PROGRESS, at: new Date(createdAt.getTime() + 0.4 * DAY), note: 'Site visit completed, work started.' })
        }
        if (isResolved && resolvedAt) {
          history.push({ from: ComplaintStatus.IN_PROGRESS, to: ComplaintStatus.RESOLVED, at: resolvedAt, note: 'Work completed and evidence submitted.' })
          if (status === ComplaintStatus.CLOSED) {
            history.push({ from: ComplaintStatus.RESOLVED, to: ComplaintStatus.CLOSED, at: resolvedAt, note: 'Verified and closed by supervisor.' })
          }
        }

        await prisma.complaintStatusHistory.createMany({
          data: history.map((h) => ({
            complaintId: complaint.id,
            fromStatus: h.from,
            toStatus: h.to,
            actorId: official?.id ?? null,
            note: h.note,
            createdAt: h.at,
          })),
        })

        created++
      }
    }
    console.log(`  ${created} complaints with status history across ${WARDS.length} wards`)
  }

  // --- GRIE ------------------------------------------------------------------
  // Imported lazily: it pulls in the app's env validation, which the schema push
  // path does not need.
  const { recomputeAll } = await import('../src/services/riskSignals.js')
  const counts = await recomputeAll()
  console.log(`  GRIE scored ${counts.wards} wards, ${counts.projects} projects, ${counts.contractors} contractors`)

  const flags = await prisma.riskFlag.findMany({ where: { status: 'PENDING' }, orderBy: { score: 'desc' } })
  if (flags.length > 0) {
    console.log(`\n  ${flags.length} entities flagged for review:`)
    for (const f of flags) console.log(`    ${f.band.padEnd(8)} ${String(f.score).padStart(6)}  ${f.entityLabel}`)
  }

  console.log(`\nDemo accounts — password: ${PASSWORD}`)
  console.log('  admin@drishti.gov.in       Administrator')
  console.log('  elec.ward1@drishti.gov.in  Field Official (Electrical, Ward 1)')
  console.log('  swm.ward5@drishti.gov.in   Field Official (Waste, Ward 5 — the busy one)')
  console.log('  citizen@example.com        Citizen (Ward 1)')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
