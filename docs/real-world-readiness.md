# What this system needs to run on a real street

> **Written before the NYC 311 rebuild**, when the corpus was invented. The
> central demand of this file — that the data be real before anything is claimed
> from it — is what the rebuild acted on: `rebuild/nyc-311` runs on 355,430
> genuine NYC service requests, and every derived figure now carries its
> provenance. The NOIDA-specific requirements (ward boundaries, the citizen
> charter, the posting register) remain future work for that deployment.

[advanced-capabilities.md](advanced-capabilities.md) says which rules should
become models. [pending-work.md](pending-work.md) says which screens are honest
about being unfinished. This file says the third thing, which neither covers:
**what real-world data has to come in, what technology has to sit between the
citizen and the officer for that data to mean anything, and what should be
deleted before any of it is built.**

The order matters. Every capability below is a chain, and a chain fails at its
weakest link — a fine-tuned classifier routing to a post nobody holds is worth
less than a keyword matcher routing to a person who answers the phone. So each
section is written as a *process*, start to finish, naming the data and the
technology at each hop, and saying plainly which hop is currently the weak one.

The prototype stays small in scale — one zone, twenty-odd sectors, three
departments, a few hundred complaints. It does not stay small in *completeness*.
Every link in the chain must exist, even if it is thin.

---

# Part I — The real-world data

Eight datasets. Four are prerequisites for anything to work at all; four can be
accumulated by running the pilot.

## 1. Ward and sector boundaries — the prerequisite

**Today.** Sector centroids are seeded approximations, and `resolveUnit()` in
`services/gcce.ts` picks the *nearest centroid* by haversine distance. That is a
guess dressed as an answer. A complaint filed on a road dividing two sectors goes
to whichever centre happens to be closer, which may not be the sector the road
belongs to.

**Needed.** Actual polygon boundaries as GeoJSON, one per ground-floor unit.

**Where it comes from.**

- The Authority's own sector maps — the master plan sheets are published.
- OpenStreetMap: Noida sectors exist as tagged administrative relations and can
  be extracted with Overpass and cleaned. Good enough to start, and free.
- The State Election Commission's ward delimitation notification for the ULB —
  this is the *legally operative* boundary set, published as GIS for every
  municipal election, and it is the one an authority would accept.

**Technology in between.** PostGIS. Add a `geometry(Polygon, 4326)` column to
`OrgUnit`, a GiST index, and replace nearest-centroid with `ST_Contains`. This is
a two-day change that converts a guess into a defensible answer, and it also
gives you `ST_DWithin` for the duplicate-clustering radius and for the
proximity-to-school factor in priority. Keep the centroid as an explicit fallback
for points falling outside every polygon — which happens, and needs an honest
answer rather than a silent nearest-match.

**Prototype volume.** One zone. Twenty to thirty polygons.

## 2. The citizen charter — the most valuable single document

**Today.** SLA hours are hand-set per category in `prisma/seed.ts` (garbage 24 h,
hanging cable 12 h, pothole 72 h). Severity 1–5 is likewise invented. The
escalation ladder walks up the org tree on a schedule we chose.

**Why this is the highest-value acquisition.** Every ULB publishes a citizen
charter, and in Uttar Pradesh the *Janhit Guarantee Adhiniyam* goes further: it
lists each notified service, its statutory timeline, the **designated officer**
who must deliver it, and the **first and second appellate officers** above them.
That document maps one-to-one onto `slaDueAt`, onto the escalation walk in
`services/escalation.ts`, and onto the designation ladder in the org tree.

Obtaining it converts the escalation mechanism from *plausible* to *statutory*.
An officer cannot argue with a deadline the state government set, and a demo that
says "this is the legal timeline, and here is the appellate officer the Act
names" is a categorically different conversation from one that says "we picked
48 hours".

**Technology in between.** None. It is a data-entry exercise — a CSV import into
`ComplaintCategory` and `Designation`. That is exactly what makes it the best
return on effort in this entire document.

**One subtlety it forces.** Statutory timelines run in *working days*. The SLA
clock must stop on Sundays and gazetted holidays, which means a holiday calendar
table and a working-day-aware deadline calculator. Municipal systems get this
wrong constantly and generate breaches that are not breaches.

## 3. The real chain of command

**Today.** 206 postings, a real designation ladder, invented people.

**Needed.**

- The department list as the Authority actually organises it.
- The sanctioned-post table: which designations exist at which layer, and how
  many of each.
- Who currently holds each post, with official contact details.
- **The charge register** — which specific sectors each Junior or Assistant
  Engineer holds, because it is rarely a clean one-officer-one-sector map.

**Where it comes from.** The Authority's officer and telephone directories, the
citizen charter (which names designated officers), or an RTI request for the
sanctioned-post statement.

**Handle with care.** Officer names and office numbers are public-directory data,
but they remain personal data. For the prototype, take the real *structure* and
real *designations*, and use placeholder contacts. The structure is the
interesting part; the phone numbers are a liability.

**Technology in between, and this is the weak link.** The tree exists. What does
not exist is a **post-occupancy feed**: transfers, retirements, leave, additional
charge. In production the most common routing failure is not misclassification —
it is a correct route to a vacant or absent post. `Posting` already carries
`validFrom`/`validTo`; what is missing is

- an import path (CSV/XLSX → `Posting`) an establishment clerk can maintain,
- a leave/absence flag with an explicit acting-officer pointer, and
- a **vacancy monitor** flagging any ground-floor post unfilled for more than N
  days — because routing is quietly falling upward and nobody has noticed.

## 4. Real complaint text

**Today.** Comma-separated keyword lists per category, including Hinglish
(`gaddha`, `kachra`, `batti`), and synthetic complaint text in the seed.

**Needed.** A few thousand real complaints in the language citizens actually
write, each paired with the department that eventually handled it. That pair —
text and resolved department — *is* the training set, and it is also the
evaluation set for the paper's comparison.

**Where it comes from.**

- **CPGRAMS** — the central public grievance portal publishes grievance text.
- **Jansunwai / IGRS Uttar Pradesh** — the state portal; closest match to our
  domain and our language mix.
- **Swachhata** app grievances, for sanitation categories specifically.
- The Authority's own X/Twitter mentions and WhatsApp helpline log, which is
  where the genuinely code-mixed text lives.
- RTI for an anonymised dump of the existing complaint register.

**Volume.** 2,000–5,000 labelled rows to fine-tune a multilingual encoder;
300–500 held out and never trained on. Below roughly 2,000 the fine-tune will
probably not beat the keyword baseline — reporting that honestly is a legitimate
result, but it is better to have enough data that the comparison is informative.

**Technology in between.** A normalisation stage before the classifier that most
Indian-language pipelines need and most skip: transliteration folding (`gaddha` /
`gadha` / `गड्ढा` must collapse), script detection, and a Hinglish-aware
tokenizer. `services/textSimilarity.ts` already carries a Hinglish stopword list;
that logic gets promoted into a shared normaliser used by both routing and
clustering, so the two engines never disagree about what a complaint says.

## 5. A photo corpus — before and after

**Needed for** the verification work in `advanced-capabilities.md` §1: paired
images, the defect as the citizen photographed it and the same spot after work,
EXIF intact, GPS on.

**Where it comes from.** Realistically, you collect it. Public sets get you
partway — RDD2022 includes Indian road damage, TACO covers waste — but nothing
public gives you *pairs of the same location before and after municipal work*,
which is the signal the whole design rests on. A field exercise of 200–400 pairs
across pothole, garbage pile and streetlight, shot on ordinary phones, is a
weekend of work and is the difference between a CV claim and a CV result.

**Handle with care.** These are photographs of public streets and will
incidentally contain faces and number plates. Plan the PII redaction pass
(`advanced-capabilities.md` §6) as part of collection, not after it.

## 6. Historical outcomes — for GRIE

Risk scores over seeded history demonstrate a mechanism; they make no claim about
any real sector. GRIE needs per-unit history: resolution times, breach rates,
escalation counts, repeat rates, reopens.

Either extract it from the public portals above, or **run the pilot for six to
eight weeks and let it accumulate** — the honest path, and one the system is
already instrumented for, since `RiskScore` keeps history and the trend becomes
visible as soon as there is any.

## 7. Reference layers

Small, free, and each closes a specific hole.

| Layer | Source | What it fixes |
|---|---|---|
| POIs — schools, hospitals, anganwadis | OpenStreetMap | Priority: a live wire outside a school is not the same complaint as one on an empty plot |
| Base map tiles | OSM / MapTiler | The map screens, without a Google bill |
| Reverse geocoding | Self-hosted Nominatim | Turning a pin into an address in the acknowledgement |
| Gazetted holiday calendar | State government notification | The SLA clock, per §2 |
| Planned power-cut schedule | Electricity distribution company | A streetlight spike that is an outage, not a fault — suppresses a whole class of false risk signal |
| Daily rainfall | IMD | Drain complaints are weather-driven; without this, every monsoon reads as a governance failure |

## 8. What we deliberately do not collect

Stated so it is a decision rather than an oversight: no Aadhaar, no
income/caste/religion attributes, no continuous location tracking of field crew,
and no contractor financials beyond the public tender record. Each would improve
some model, and none survives a serious privacy review.

---

# Part II — The technology between the citizen and the officer

## Capability 1 — The complaint routes itself, with nothing asked of the citizen

**The claim.** A citizen writes what is wrong, in their own words, and never
chooses a department — because they do not know the difference between the Public
Health Department and the Jal Vibhag, and asking them to guess is how complaints
land in the wrong queue and sit there.

**The chain, hop by hop.**

1. **Intake.** Free text, a photo, and — if permitted — a location. Voice as an
   equal-status option (Capability 7), because typing is the barrier for a large
   share of this user base.

2. **Normalisation.** Language and script detection, transliteration folding,
   Hinglish tokenisation. Shared with clustering so both engines see the same
   normalised string.

3. **Classification.** Today, `matchCategory()` — word-boundary keyword hits,
   highest count wins. Real: a fine-tuned multilingual encoder (**MuRIL** or
   **IndicBERT**, both trained on transliterated Hindi, which is what people
   actually type) returning top-k categories with confidence. Below a confidence
   floor it **abstains** and the keyword matcher answers; below both, the
   complaint enters a manual-categorisation queue rather than being guessed into
   a department.

   Record which path decided, on every complaint. That single column is
   simultaneously the operational safety net and the paper's dataset.

4. **Severity extraction.** Span tagging over danger language — *spark, current,
   bacha, gir gaya, nanga tar*. `services/priority.ts` already holds the term
   list; the model replaces substring matching with something that survives
   negation, so "koi current nahi hai" does not raise urgency.

5. **Geo-resolution**, in strict precedence: photo EXIF GPS → device GPS →
   geocoded address → the citizen's registered home unit. Then **PostGIS
   point-in-polygon** against ward boundaries. Record which source was used and
   show it to the officer, because the confidence of everything downstream
   depends on it.

6. **Department and layer resolution.** Category → department; the department's
   configured operating depth (`DepartmentLayer`) → which layer dispatches. This
   already works, and it is one of the better decisions in the codebase —
   Horticulture running two layers while Civil runs three, over one shared map of
   the city.

7. **Post resolution.** Unit + department + deepest designation → the officer
   *currently holding* that post. Vacant, retired or on leave → walk up the tree,
   and say in the trace that it walked and why. This is the hop that breaks in
   production, and §I.3 is what fixes it.

8. **Deduplication, before creation.** Is this the same problem someone already
   reported? Sentence-embedding similarity **and** spatial proximity **and** a
   time window **and** the same category → attach as a support to the existing
   complaint rather than opening a new one. In real municipal traffic this
   collapses a large share of intake, and it is what makes the support-count
   factor in priority mean "many households" rather than "one persistent person".

9. **Acknowledgement.** Reference number, statutory deadline, and the *named*
   officer with their designation, delivered by SMS or WhatsApp. Naming the
   officer is the entire point: an accountable system tells you who is
   accountable.

**Technology to add.** A small Python inference service (FastAPI) beside the Node
API, serving the classifier and the sentence embedder through **ONNX Runtime** on
CPU — at this scale no GPU is needed and adding one is a distraction. **pgvector**
inside the existing Postgres, so dedup is a SQL query and not a second datastore.
**PostGIS** for the geometry. A job queue (**BullMQ** on Redis) so classification
and dedup stay out of the request path.

**One thing to remove for this to be true.** The new-complaint form currently
offers a category picker, and `resolveCategory()` short-circuits on it —
*"Category was chosen by the citizen."* That contradicts the claim, and worse, it
contaminates the training labels with citizen guesses. Turn it into a
**confirmation shown after classification** — "we have sent this to Electrical; is
that right?" — which preserves citizen correction, keeps the label clean, and
yields a free stream of human feedback on model output.

## Capability 2 — Priority an officer can argue with

**Today.** `computePriority()` — a weighted sum over category severity, support
count, age against SLA, and danger terms, each factor carrying its own
`contribution` and a sentence of explanation.

**What real data adds.**

| Factor | Needs | Why |
|---|---|---|
| Statutory severity | The charter (§I.2) | Severity stops being our opinion |
| Vulnerable-location proximity | OSM POI layer | A fault outside a school outranks the same fault on an empty plot |
| True support count | Embedding dedup | Distinct households, not distinct submissions |
| Recurrence at this spot | Complaint history + PostGIS | The fourth failure on one streetlight pole is a different problem from the first |
| Weather amplification | IMD rainfall | Drain urgency is genuinely weather-dependent |
| Equity guard | Complaint rate per capita per ward | **The one that must be built deliberately** |

**On the equity guard.** Complaint volume measures *propensity to complain*, not
*need*. Affluent, connected sectors generate more complaints and, under any naive
priority rule, capture more attention — so the system quietly widens the gap it
was built to close. The correction is a factor that raises priority in wards with
structurally low reporting rates. It is a value judgement, it should appear as
its own line in the explanation, and it should be argued about openly rather than
buried inside a weight.

**The model comparison.** Gradient boosting with **monotonic constraints** — more
overdue can never lower priority — plus SHAP for per-factor attribution, scored
against the weighted sum. Report the accuracy gap *and* a simulatability measure:
can an officer predict the output from the explanation? That pairing is the
research contribution.

## Capability 3 — Risk factors and risk queues

**Entities scored.** Org units at any depth, and departments. Contractors and
projects are scored today on synthetic rows — see the cut list.

**Signals worth adding to `services/riskSignals.ts`.**

- **Reopen rate** — complaints marked resolved that come back. The purest quality
  signal available, and currently uncollected.
- **Verification failure rate** and **citizen dispute rate**, from Capability 4.
- **The aging tail (p90, not mean)** — a unit closing 90% of complaints in a day
  and abandoning 10% for a month looks healthy on an average and is not.
- **Silence anomaly** — a ward whose complaint volume drops sharply. Usually it
  means people stopped believing the system, which is a governance risk no
  complaint will ever report.
- **First-touch latency** — arrival to first officer action, separate from time
  to resolution. It is the number that predicts a breach earliest.

**What makes it a queue rather than a dashboard.** Every row carries an action and
an owner, and a flag is closed by *doing something*, not by reading it. That is
already the design; it is worth restating because risk screens decay into
dashboards by default.

**Technology.** Scheduled recompute (the existing `services/scheduler.ts`, or
BullMQ repeatable jobs), score history for trend lines, threshold flags feeding
the review workflow, and SHAP-versus-weights for the paper.

**A governance caution.** Scoring *individual officers* is technically easy and
institutionally explosive — it will be read as surveillance, and it is the
fastest way to lose the cooperation a pilot depends on. Score units. If an
officer-level view exists at all, show it to that officer first.

## Capability 4 — Proving the work was actually done

**Today.** Five checks in `assessSubmission()`: something was submitted, the file
is not reused, the EXIF timestamp postdates the work order, the EXIF GPS falls
within 2.5 km of the sector centroid, and it arrived before the deadline. Score
weighted, outcome banded, citizen asked, officer called in only on dispute.

**The honest limit, restated.** Not one of those checks looks at the picture.

**The real pipeline, in stages.**

**Stage 0 — capture integrity.** *This is the highest-value change in this entire
document, and it needs no model.* Proof must be **captured in-app**, never
selected from the gallery. EXIF is a text field any phone app can write; treating
it as evidence is an exposure the current design carries. What replaces it:

- camera-only capture in the field surface,
- the server stamping arrival time rather than trusting the file,
- device attestation (Play Integrity) where available,
- the GPS reading taken from the OS at capture and sent alongside the image,
  rather than read back out of it.

Everything downstream is worth more once the input is honest.

**Stage 1 — cheap gates, at the moment of upload, while the worker is still
standing there.** Laplacian-variance blur detection, exposure check, minimum
resolution. And **perceptual hashing (pHash/dHash) replacing SHA-256** for
duplicate detection: today a worker who re-saves a recycled photo at 90% quality
walks straight through the content hash. Small, no training, closes a live hole.

**Stage 2 — is this the right place?** GPS proximity to the *complaint's own
coordinates*, not the sector centroid — 2.5 km is a tolerance that admits proof
from the wrong neighbourhood. Then local feature matching (**SIFT**, or
**LoFTR** for hard pairs) between the citizen's photo and the proof: *is this the
same spot?* That is the fraud EXIF structurally cannot catch — a real photo,
really taken today, really inside the sector, of a different intact stretch of
road.

**Stage 3 — did the thing change?** Before/after embedding distance (DINOv2
features or a Siamese head) plus a fine-tuned detector (**YOLO**-class) over
pothole, garbage pile and broken streetlight. The claim to establish is compound
and should be stated as such in the explanation: *defect present in the before
image, absent in the after image, same location, same day.*

**Stage 4 — the human, moved rather than removed.** The citizen who reported it
confirms; a grace period converts silence into assent only where the automated
score was strong; the officer is called in on dispute or on a weak score. The
existing design here is right and should not change — what changes is that far
fewer cases reach a human at all.

**Technology.** The same Python sidecar and ONNX runtime. Object storage
(**MinIO** locally, S3-compatible in production) instead of a local `uploads`
directory. **pgvector** for image embeddings. The queue, for async inference.

**Measurement.** `Verification.outcome` and `Complaint.citizenConfirmed` are
already accumulating a labelled evaluation set for free. Report precision and
recall against citizen verdicts, and — the number an authority would actually buy
— the reduction in officer interventions per hundred closures.

## Capability 5 — The record cannot be quietly altered

**Today.** `services/audit.ts` implements a real hash chain: each event's SHA-256
covers its canonical content plus the previous event's hash, `verifyChain()`
detects any break, and events are written inside the same transaction as the
action they record. This is genuinely good, and further than most systems of this
kind get.

**What it does not yet establish, stated bluntly.** The Authority controls the
database. Anyone with `psql` and the source can edit a historical row and
recompute every hash after it, and `verifyChain()` will then report a perfect
chain. Today the guarantee is *"our application will not edit history"*, which is
a convention. Real usage needs it to be a property. Five changes, ascending in
effort:

1. **Make append-only a database fact.** `BEFORE UPDATE OR DELETE` triggers that
   raise on `complaints`, `complaint_status_history` and `audit_events`; and an
   application role holding `INSERT`/`SELECT` on those tables and nothing else.
   The application then cannot rewrite history even if a bug or an operator
   tries.

2. **Sign the events.** Chain each event with an HMAC or Ed25519 signature under
   a key held outside the database, ideally in a KMS or HSM. Recomputation then
   requires the key, not merely the algorithm. This is the change that turns "we
   would have had to edit it deliberately" into "we could not have".

3. **Anchor the head externally, daily.** The chain proves nothing to an outsider
   while one party holds all of it. Publishing the day's head hash somewhere the
   Authority does not control fixes exactly that, and it is a day's work: an
   **RFC 3161** trusted timestamp, an append to a transparency log, a signed
   digest published to a public page, or — if there is appetite — one transaction
   a day on a public chain. All four give the same property, and none requires
   putting citizen data on a ledger, which remains the wrong idea for the reasons
   in `advanced-capabilities.md` §5.

4. **Make the photos immutable too.** A hash chain over rows pointing at a mutable
   `uploads/` directory secures the wrong half. Content-addressed filenames,
   write-once storage (S3 Object Lock / MinIO WORM), and the file hash carried
   inside the chained event.

5. **Corrections as events, never as edits.** A genuine typo becomes a
   `CORRECTION` event referencing the original; both stay visible; the complaint
   view shows current text with correction history beside it. "No editing" must
   not mean "no way to fix a mistake", or people will route around it.

**The tension that must be solved, not ignored.** The DPDP Act gives a citizen the
right to erasure, and an immutable chain cannot forget. The standard resolution is
**crypto-shredding**: store personal fields encrypted under a per-subject key, and
on an erasure request destroy the key. The ciphertext stays, so every hash still
verifies; the content is gone. Design this now — retrofitting means re-encrypting
the whole corpus.

**The surface that makes it worth having.** A public verification page: anyone
holding a reference number can see that complaint's chain segment and check the
hashes themselves. Tamper-evidence only we can check is decoration.

## Capability 6 — Identity, and keeping the data worth trusting

Not on the original list and arguably prior to all of it: **every signal in this
system is gameable by anyone with a script** until intake is authenticated.
Support counts drive priority; complaint volume drives risk; both are trivially
inflatable today.

- **Phone-OTP identity** as the primary factor. In India that means an SMS gateway
  with **DLT-registered templates** — a regulatory step with a lead time, worth
  starting early.
- Rate limits per phone, per device, per IP, per polygon.
- Duplicate-account detection with a soft-ban path a human reviews.
- **PII masking by scope**: a citizen's phone number is visible to the officer
  handling the case and nobody else, including officers of equal rank elsewhere.
  The scoping logic in `services/orgTree.ts` is the sharpest part of this
  codebase; extend it to fields, not just rows.

## Capability 7 — Reaching people who will not type

The citizen-confirmation loop in Capability 4 is load-bearing: the verification
design spends citizen attention as its scarcest resource. That only works if
reaching a citizen is easy.

- **WhatsApp Business API** and SMS for acknowledgement, confirmation requests and
  closure. Push notifications will not reach this user base.
- **Voice intake** — Whisper or IndicWav2Vec — as a first-class path, plus an IVR
  number. The people worst served by municipal services are the least likely to
  file a typed complaint, and a system that only hears from typists will
  faithfully reproduce that bias in its risk scores.
- **Offline-tolerant field capture** — a service worker queueing uploads, because
  crews work on patchy 3G and a failed upload today means a return visit
  tomorrow.

## Capability 8 — Knowing whether any of this worked

Non-negotiable for a pilot and cheap: structured logs, error tracking (Sentry),
and a metrics endpoint. The specific things to instrument are **how often routing
was corrected by a human**, **how often verification was overridden**, and **how
long first touch took** — the three numbers that say whether the automation is
helping or being worked around.

---

# Part III — What to remove now

Cut first, build second. Each item is dead, duplicated, or a second product
wearing this one's clothes.

### 1. Neo4j — the clearest cut

`services/graphSync.ts` writes complaints, units and officers into the graph, and
`routes/system.ts` health-checks it. **Nothing anywhere in `src/` ever queries
it** — there is not one `MATCH … RETURN` in the codebase outside `RETURN 1`. It
costs a container, 512 MB of heap, two published ports, an environment block, a
driver dependency and a sync hop on the write path, and it returns no feature.

Drop it from `docker-compose.yml` and `.env`, remove the driver, and keep the sync
module in git history. The org tree is a recursive CTE in Postgres, which is what
it should be. Re-introduce a graph only when a genuine multi-hop question exists
*and a screen asks it* — "which officers repeatedly hand work to the crew with the
worst verification record" is that kind of question, and no screen asks it today.

### 2. Contractors, Projects, Inspections

Three and five seeded rows, no acquisition path, and GRIE scoring them on invented
history. This is contract-and-works management — a real and larger product — and
carrying a hollow version of it inside the grievance ecosystem makes the whole
system read as a mock-up. Remove the surfaces; leave the models dormant if the
schema is worth keeping on record, and record in `pending-work.md` that works
management is a later *product* rather than an unfinished screen.

### 3. The legacy geography — `Zone` / `Circle` / `Sector`, `Rank`, `JurisdictionLevel`

Superseded by `OrgUnit`, still read at nineteen call sites, still written by older
routes, and still exposed through `GET /geography` for six pickers. **Two live
representations of the same geography is precisely how routing bugs are born**,
and Capability 1 is about to depend on geography being unambiguous. Finish the
migration, drop the tables and the enums, and delete the
`/console/units/resolve/:kind/:id` shim along with them.

### 4. The duplicated screens

`/admin/complaints` vs `/admin/console/complaints`; `/admin/people` vs
`/admin/console/staff`; `/admin/departments` vs `/admin/console/departments`;
`/admin/map` vs `/officer/map`. Different audiences was the reason for the split,
and scoping is the right way to serve different audiences — one screen that knows
who is looking at it. Four pairs, four merges.

### 5. The legacy city console — `/admin/console/city/*`

Zone, circle and sector pages reading a structure the tree already renders at
`/admin/org/[unitId]`. Kept as redirects; they can go when the legacy tables do.

### 6. The category picker on the new-complaint form

Per Capability 1: it contradicts the claim and contaminates the labels. Becomes a
post-classification confirmation.

### 7. `Escalation.fromRank` / `toRank`

Historical, no longer written, and pinned to the enum being deleted in §3.

### 8. `/admin/dashboard`, if it is a metrics wall

The house rule here is drill-down, not dashboards — the risk queue and the
escalation inbox *are* the landing surface, because every row is a thing to do.
Keep whatever on that page is a queue; drop whatever is a number with no action
attached to it.

---

# Part IV — The prototype, scoped

Small in scale, complete in chain. One zone, three departments, twenty-odd sectors
with real polygons, real charter timelines, a real designation ladder, placeholder
people, and a few hundred complaints of which a hundred carry real text.

**Order of work, and why this order.**

1. **The cut list.** Everything in Part III. It removes more code than the next
   four steps add, and every subsequent step gets cheaper once there is one
   geography, one complaints screen, and no graph to keep in sync.

2. **PostGIS boundaries.** Routing stops guessing. Unlocks the proximity factors
   in priority and the radius in clustering.

3. **The charter import.** Statutory SLAs, real severity, named appellate
   officers, and the working-day calendar. Highest value per hour of work in this
   document, and no new technology required.

4. **Capture integrity, perceptual hashing, the blur gate.** No models, no
   training, and it closes the two holes a determined worker walks through today.

5. **Enforced append-only and event signing.** Two days. Converts the audit chain
   from a convention into a property, which is what the "cannot be tampered with"
   claim actually needs.

6. **Phone-OTP identity and SMS/WhatsApp delivery.** Everything above is measured
   on data that is only trustworthy once intake is. Start the DLT registration
   early — it waits on someone else's clock.

7. **The NLP router** — normaliser, fine-tuned encoder with keyword fallback,
   embedding dedup on pgvector. The first genuine model, and the largest
   operational win.

8. **Before/after CV verification.** The headline capability, once the photo
   corpus from step 4's live traffic plus the field-collection exercise exists.

9. **External anchoring**, whenever outside verifiability is wanted. One day.

10. **The interpretability study.** Last, because it needs both the learned router
    and the learned risk model to compare the transparent ones against.

Forecasting and contractor escrow stay where `advanced-capabilities.md` put them:
genuinely later.

---

## The three things that decide whether this is real

Everything above compresses to three sentences, and it is worth being able to say
them.

**A complaint is routed by boundary and post, not by keyword and guess.** That is
PostGIS plus a maintained posting register, and it is why the officer who receives
it is the right one.

**Proof is captured, not uploaded.** That is one change in the field surface, and
every verification model built afterwards is worth more because of it.

**History is append-only in the database and anchored outside it.** That is a
trigger, a signature and a daily digest, and it is the difference between a system
that promises it does not edit the record and one that could not.
