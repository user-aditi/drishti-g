/**
 * What a simulated citizen actually writes.
 *
 * Every complaint the simulator files is real text posted through the real
 * endpoint, and GCCE classifies it with the same keyword matcher it uses in
 * production. That makes this file load-bearing in a way it looks like it is
 * not: the text here determines whether routing succeeds, and the routing
 * decisions become the training data for the classifier that replaces the
 * keyword matcher in W3.1.
 *
 * So two rules hold.
 *
 * **The text must not be a template with the category name in it.** "Garbage
 * Not Collected in Sector 62" would let the matcher score 100% and would teach
 * the classifier that the job is trivial. Real complaints are vague, misspelled,
 * bilingual, and sometimes describe the consequence rather than the cause.
 * Several phrasings here deliberately contain no keyword at all, and a handful
 * contain a keyword belonging to the *wrong* category — which is what makes the
 * citizen's correction step (`POST /complaints/:id/category`) fire on something
 * other than noise.
 *
 * **The mix must be weighted like a real municipal load.** Sanitation and
 * drainage dominate a North Indian municipal desk; footpaths and public toilets
 * are a trickle. Weights below are a judgement, not a measurement — there is no
 * public NOIDA Authority complaint breakdown to calibrate against — and they
 * are flagged as such in docs/pending-work.md.
 *
 * Seasonality is handled separately by the simulator: drainage complaints
 * multiply during monsoon months, which is what produces the arrival bursts the
 * clustering engine is supposed to catch.
 */

export interface ComplaintTemplate {
  /** Category name as seeded, for reporting only — never sent to the API. */
  category: string
  /** Relative share of the municipal load. */
  weight: number
  /** Extra multiplier during monsoon months (July–September). */
  monsoon?: number
  phrasings: { title: string; description: string }[]
}

export const TEMPLATES: ComplaintTemplate[] = [
  {
    category: 'Garbage Not Collected',
    weight: 22,
    phrasings: [
      {
        title: 'Kooda not picked up since last week',
        description:
          'The garbage has not been collected from our lane for six or seven days now. The pile is at the corner near the park gate and it is spreading onto the road. Dogs are pulling it apart every night.',
      },
      {
        title: 'Dustbin overflowing near market',
        description:
          'The community bin behind the market block is completely full and rubbish is lying all around it. Nobody has come to empty it. Please arrange safai urgently, the smell is unbearable in the afternoon.',
      },
      {
        title: 'Sweeper has not come to our block',
        description:
          'No one from the sanitation staff has visited our block for many days. Waste is accumulating outside the houses and residents are dumping it in the empty plot.',
      },
      {
        // No category keyword at all — describes only the consequence.
        title: 'Very bad smell in our lane',
        description:
          'There is a terrible smell coming from the corner of our street. Flies everywhere and we cannot open the windows. Something needs to be cleared away, it has been like this for days.',
      },
    ],
  },
  {
    category: 'Blocked Drain / Sewage Overflow',
    weight: 18,
    monsoon: 3.2,
    phrasings: [
      {
        title: 'Nali choked, water on the road',
        description:
          'The drain outside our house is completely blocked and dirty water is standing on the road. It has started coming towards the gate. This happens every year and nothing is done permanently.',
      },
      {
        title: 'Sewage overflowing near the school',
        description:
          'Sewage is overflowing from the manhole on the approach road to the school. Children are walking through it every morning. Please send someone to clear the blockage.',
      },
      {
        title: 'Jalbharav after last night rain',
        description:
          'After yesterday night rain there is knee deep water logging in front of the block. The nalla is not taking the water at all. Two-wheelers are getting stuck.',
      },
      {
        title: 'Manhole cover missing and water standing',
        description:
          'The manhole cover on our street has been missing for a while and now with the water standing nobody can see where it is. Someone will fall into it. Very dangerous.',
      },
    ],
  },
  {
    category: 'Streetlight Not Working',
    weight: 16,
    phrasings: [
      {
        title: 'Street light not working for two weeks',
        description:
          'The street light pole outside house number 42 has not been working for around two weeks. The whole stretch is dark after 7pm and it feels unsafe for women returning from work.',
      },
      {
        title: 'Poori gali mein andhera hai',
        description:
          'All the lights in our lane are off. Batti nahi jal rahi since the storm. Please get them repaired, there have been two chain snatching incidents nearby.',
      },
      {
        // Deliberately ambiguous: reads as electrical but is really a pole/road issue.
        title: 'Light pole leaning dangerously',
        description:
          'The khambha near the park has tilted badly after the rain and looks like it will fall. It is still lighting but leaning right over the footpath where people walk.',
      },
    ],
  },
  {
    category: 'Pothole / Damaged Road',
    weight: 14,
    monsoon: 1.8,
    phrasings: [
      {
        title: 'Big gaddha on the main approach road',
        description:
          'There is a very large pothole on the approach road just before the turning. Two scooters have already fallen. It gets filled with water and then nobody can judge the depth.',
      },
      {
        title: 'Road broken after pipeline work',
        description:
          'The road was dug up for pipeline work and never properly repaired. The patchwork has sunk and now the whole stretch is uneven and full of loose stones.',
      },
      {
        title: 'Sadak ki halat kharab hai',
        description:
          'The condition of our road is very bad. It has not been repaired for years and now there are potholes everywhere. Auto drivers refuse to come inside the sector.',
      },
    ],
  },
  {
    category: 'Street Not Swept',
    weight: 9,
    phrasings: [
      {
        title: 'Malba lying on the roadside',
        description:
          'Construction debris has been dumped on the roadside near the corner plot and it has been lying there for over a week. Dust is blowing into the houses.',
      },
      {
        title: 'Road not swept, dust everywhere',
        description:
          'The sweeping has not happened in our stretch for many days. There is a thick layer of dust and leaves along both sides of the road.',
      },
    ],
  },
  {
    category: 'Hanging or Broken Cable',
    weight: 7,
    phrasings: [
      {
        title: 'Live wire hanging low over the road',
        description:
          'There is an electric wire hanging very low across the lane, low enough that a tall vehicle would catch it. There was sparking from it two nights ago. This is extremely dangerous.',
      },
      {
        title: 'Bundle of cables fallen on footpath',
        description:
          'A bunch of cables has come loose from the pole and is lying across the footpath. People are stepping over it. Please get it secured.',
      },
    ],
  },
  {
    category: 'Dead Animal Removal',
    weight: 5,
    phrasings: [
      {
        title: 'Dead dog near the sector gate',
        description:
          'A stray dog has died near the sector gate and the carcass has been lying there since yesterday. Please arrange for removal, the badbu is spreading.',
      },
    ],
  },
  {
    category: 'Pump House Fault',
    weight: 4,
    phrasings: [
      {
        title: 'No water supply, pump seems off',
        description:
          'There has been no water supply in our block since morning. Neighbours say the motor at the pump house is not running. Please check, we have no storage left.',
      },
      {
        // No keyword for the pump category; reads as a general water complaint.
        title: 'Paani nahi aa raha',
        description:
          'No water has come in the taps for two days now. Everyone in the block is affected. We are buying water from outside which is not affordable for everyone here.',
      },
    ],
  },
  {
    category: 'Damaged Footpath',
    weight: 3,
    phrasings: [
      {
        title: 'Broken paver tiles on the footpath',
        description:
          'Several paver tiles on the footpath have come loose and a few are missing entirely. An elderly resident tripped on it last week.',
      },
    ],
  },
  {
    category: 'Public Toilet Issue',
    weight: 2,
    phrasings: [
      {
        title: 'Public toilet not cleaned',
        description:
          'The public toilet near the market has not been cleaned for several days. There is no water in it either. It is unusable in this condition.',
      },
    ],
  },
]

/**
 * Reasons an officer gives for sending a complaint somewhere else.
 *
 * A fixed list rather than free text, because this becomes a training label in
 * W2.3 and prose does not aggregate. These are the five things that actually go
 * wrong with automatic routing.
 */
export const OVERRIDE_REASONS = [
  'Wrong department — this is not our work',
  'Wrong sector — the location falls outside my charge',
  'Category misread — the description says something else',
  'Already covered by another complaint',
  'Needs a higher authority to decide',
] as const

/** Notes a crew member writes when reporting a job done. */
export const CREW_NOTES = [
  'Work completed. Area cleared and cleaned.',
  'Done. Material used from sector store.',
  'Repaired and tested, working now.',
  'Cleared the blockage, water is flowing.',
  'Replaced the damaged part. Photo attached.',
  'Job finished, site handed back.',
]

/** What an officer writes when sending work back. */
export const REJECTION_NOTES = [
  'Work is incomplete — only half the stretch has been done.',
  'Photo does not show the actual location of the complaint.',
  'The problem has recurred within two days. Redo properly.',
  'Debris from the work has been left on site. Clear it.',
]
