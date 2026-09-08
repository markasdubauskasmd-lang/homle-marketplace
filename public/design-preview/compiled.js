window.__homlleLogic={"const ICON = {\n  user: \"M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5\",\n  bell: \"M6 16v-5a6 6 0 1 1 12 0v5l2 3H4zM10 19a2 2 0 0 0 4 0\",\n  help: \"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.7 2.7 0 1 1 4.1 2.3c-1 .7-1.6 1.1-1.6 2.2M12 17h.01\",\n  chat: \"M4 5h16v11H9l-5 4zM8 9h8M8 12h5\",\n  shield: \"M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6zM9 12l2 2 4-4\",\n  gear: \"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1\",\n  logout: \"M10 4H5v16h5M14 8l4 4-4 4M18 12H9\"\n};\n\nconst PAGES = {\n  activity:    { kicker: \"31 AUG – 6 SEPT\", title: \"Activity schedule\", sub: \"See selected work by week, then review every clean's price, area, type and property images below.\" },\n  \"jobs-map\":  { kicker: \"YOUR WORK AREAS\", title: \"Jobs near you\", sub: \"Explore available jobs by area, then review the full clean details before deciding.\" },\n  messages:    { kicker: \"PRIVATE BOOKING CONVERSATIONS\", title: \"Messages\", sub: \"Chat with clients and the Homlle team. Numbers stay private — everything goes through the app.\" },\n  earnings:    { kicker: \"CLEANER PAYOUTS\", title: \"Earnings\", sub: \"Agreed Cleaner pay on completed jobs, and how payouts get set up.\" },\n  performance: { kicker: \"RATING & BADGES\", title: \"Performance\", sub: \"Clients rate every completed job. Ratings drive how often you're offered work.\" },\n  profile:     { kicker: \"YOUR PUBLIC PROFILE\", title: \"Your public profile\", sub: \"Exactly what clients see when Homlle offers them your profile. It updates live as you edit your registration.\" },\n  reviews:     { kicker: \"REVIEWS & RATINGS\", title: \"Reviews & ratings\", sub: \"Clients rate every completed job. Ratings drive how often you're offered work.\" },\n  job:         { kicker: \"CONFIRMED VISIT\", title: \"Deep clean · 3 bed house\", sub: \"Sun 6 Sept · 09:00 · LS6 · 3.5 hours · £68.00 agreed Cleaner pay.\" }\n};\n\nconst ACCOUNT = [\n  { label: \"My Profile\", icon: ICON.user, href: \"#profile\", note: \"CURRENT PAGE\" },\n  { label: \"Notifications\", icon: ICON.bell, href: \"#profile\", note: \"NOT IN THIS PASS\" },\n  { label: \"Help Centre\", icon: ICON.help, href: \"#profile\", note: \"NOT IN THIS PASS\" },\n  { label: \"Support Tickets\", icon: ICON.chat, href: \"#profile\", note: \"NOT IN THIS PASS\" },\n  { label: \"Report an Incident\", icon: ICON.shield, href: \"#profile\", note: \"NOT IN THIS PASS\" },\n  { label: \"My Disputes\", icon: ICON.shield, href: \"#profile\", note: \"NOT IN THIS PASS\" },\n  { label: \"Settings\", icon: ICON.gear, href: \"#profile\", note: \"NOT IN THIS PASS\" },\n  { label: \"Logout\", icon: ICON.logout, href: \"\", note: \"SIGNS OUT TO /LOGIN\" }\n];\n\nconst THREADS = [\n  { name: \"Jordan · LS6 deep clean\", preview: \"Perfect. Oven's the main thing if you have time.\", when: \"09:12\", initial: \"J\",\n    messages: [\n      { them: \"Morning! The key is in the lockbox, code is on your job sheet.\" },\n      { me: \"On my way\" },\n      { them: \"Perfect. Oven's the main thing if you have time.\" }\n    ] },\n  { name: \"Homlle Support\", preview: \"Your insurance certificate is still outstanding.\", when: \"Fri\", initial: \"H\",\n    messages: [\n      { them: \"Your insurance certificate is still outstanding.\" },\n      { them: \"Upload it on the Insurance step and we'll review it within two working days.\" }\n    ] },\n  { name: \"Priya · LS1\", preview: \"Thanks for accepting — see you Tuesday at one.\", when: \"Thu\", initial: \"P\",\n    messages: [\n      { me: \"Happy to take Tuesday at one.\" },\n      { them: \"Thanks for accepting — see you Tuesday at one.\" }\n    ] }\n];\n\nconst OFFERS = [\n  { title: \"Regular clean · 2 bed flat\", area: \"LS1\", when: \"Tue 8 Sept · 13:00–15:00\",\n    hours: 2, miles: \"4.1\", drive: \"14 min\", leaveBy: \"12:40\", frequency: \"One-off\",\n    client: 45, fee: 9, pay: 36, expires: 3 * 3600 + 42 * 60,\n    scope: [\"Kitchen — surfaces, hob, sink, floor\", \"Bathroom — bath, shower, WC, mirror\", \"Two bedrooms — dust and vacuum\", \"Living room — dust, vacuum, tidy\"],\n    extras: [\"Client provides all products and equipment.\", \"Key is in a lockbox — the code appears once you accept.\"] },\n  { title: \"End of tenancy\", area: \"LS2\", when: \"Thu 10 Sept · 10:00–15:00\",\n    hours: 5, miles: \"6.8\", drive: \"22 min\", leaveBy: \"09:30\", frequency: \"One-off\",\n    client: 118.75, fee: 23.75, pay: 95, expires: 21 * 3600 + 6 * 60,\n    scope: [\"Whole two-bed flat, empty of furniture\", \"Oven deep clean, inside and out\", \"Windows inside, sills and frames\", \"Skirtings, doors and light switches\", \"Carpets vacuumed throughout\"],\n    extras: [\"You bring your own products and equipment.\", \"The letting agent meets you on arrival.\"] }\n];\n\n/* Every status, label and action label below is verbatim from\n * public/active-job-model.js — `activeJobStages`, `activeJobStatusLabels` and\n * the descriptors `activeJobAction()` returns for the cleaner role. The notes\n * are the only authored strings here.\n *\n * Two label maps exist for the same statuses and they are not interchangeable:\n * activeJobStatusLabels (this screen, both roles watching the job) says\n * \"Cleaning finished\" for awaiting-review, while bookingSummaryStatusLabels\n * (the booking lists) says \"Awaiting review\". Use the map that owns the surface.\n *\n * `completed` is deliberately absent: the Landlord confirms it, so the Cleaner\n * screen stops at awaiting-review. */\nconst STAGES = [\n  { status: \"confirmed\",\n    note: \"Set off and tell the client — they see you are travelling, not your location.\" },\n  { status: \"cleaner-en-route\",\n    note: \"The client can see you are travelling. Message them if you are held up.\" },\n  { status: \"cleaner-arrived\",\n    note: \"Check you can get in and that the job matches the description before you start.\" },\n  { status: \"cleaning-in-progress\",\n    note: \"Tick each task as you finish it. The client sees progress, not the ticks themselves.\" },\n  { status: \"awaiting-review\",\n    note: \"Waiting for Landlord confirmation. Your completed checklist and evidence are ready for them to review.\" }\n];\n\n/* Shown only until import(\"./homlle-booking.js\") resolves. If a label here ever\n * differs from the module's, the module wins — these are never authoritative. */\nconst FALLBACK_LABEL = {\n  confirmed: \"Booking confirmed\",\n  \"cleaner-en-route\": \"Cleaner en route\",\n  \"cleaner-arrived\": \"Cleaner arrived\",\n  \"cleaning-in-progress\": \"Cleaning in progress\",\n  \"awaiting-review\": \"Cleaning finished\"\n};\nconst FALLBACK_ACTION = {\n  confirmed: \"Start journey\",\n  \"cleaner-en-route\": \"I have arrived\",\n  \"cleaner-arrived\": \"Start cleaning\",\n  \"cleaning-in-progress\": \"Finish cleaning\"\n};\n\nconst ROOMS = [\n  { name: \"KITCHEN\", items: [\"Worktops and splashback\", \"Hob and extractor\", \"Sink and taps\", \"Inside the oven\", \"Floor\"] },\n  { name: \"BATHROOM\", items: [\"Bath and shower\", \"WC\", \"Sink and mirror\", \"Tiles and grout\", \"Floor\"] },\n  { name: \"THREE BEDROOMS\", items: [\"Dust all surfaces\", \"Change the bedding\", \"Vacuum\"] },\n  { name: \"LIVING ROOM\", items: [\"Dust and polish\", \"Vacuum\", \"Tidy and cushions\"] },\n  { name: \"HALL AND STAIRS\", items: [\"Vacuum\", \"Skirtings and switches\"] }\n];\n\nconst DAYS = [\"MON\", \"TUE\", \"WED\", \"THU\", \"FRI\", \"SAT\", \"SUN\"];\n\nconst WEEKS = [\n  { label: \"31 AUG – 6 SEPT\", short: \"this week\",\n    note: \"One clean booked today, outlined. Tap any day to see jobs going in your areas.\",\n    days: [0, 0, 0, 0, 0, 0, 2],\n    value: 68, hours: \"3.5\",\n    hero: { badge: \"TODAY · 09:00\", title: \"Deep clean · 3 bed house\", area: \"LS6\", hours: \"3.5\", pay: \"£68.00\" },\n    jobs: [{ title: \"Deep clean · 3 bed house\", meta: \"Sun 6 Sept · 09:00 · LS6 · 3.5 hours · confirmed\", pay: \"£68.00\" }] },\n  { label: \"7 – 13 SEPT\", short: \"week of 7 Sept\",\n    note: \"Two offers are waiting on your reply — nothing confirmed yet. Tap a day to open the map.\",\n    days: [0, 1, 0, 1, 0, 0, 0],\n    value: 0, hours: \"0\",\n    hero: null, emptyBadge: \"NOTHING CONFIRMED\", emptyTitle: \"Two offers, no bookings\",\n    emptyLine: \"Reply to the offers on Tue 8 and Thu 10 and they land in this week.\",\n    jobs: [] },\n  { label: \"14 – 20 SEPT\", short: \"week of 14 Sept\",\n    note: \"Nothing booked yet. Jobs in your work areas appear on the map as clients post them.\",\n    days: [0, 0, 0, 0, 0, 0, 0],\n    value: 0, hours: \"0\",\n    hero: null, emptyBadge: \"NOTHING BOOKED\", emptyTitle: \"This week is open\",\n    emptyLine: \"Nothing offered for this week yet. Widening your travel radius brings more work in.\",\n    jobs: [] }\n];\n\n/* The seam. `homlle-booking.js` owns the booking record and the pure functions\n * over it; the Landlord view is a second consumer of the same module. Loading\n * it here proves the boundary instead of describing it. */\nlet BOOKING = null;\n\nconst INCIDENTS = [\n  { value: \"access\", label: \"Can't get in\", heading: \"Message the client first\",\n    text: \"Wait at the property and message the client. If there is no reply after 15 minutes, report it here — Homlle logs your arrival so waiting time can be considered.\" },\n  { value: \"scope\", label: \"Job is bigger than described\", heading: \"Do not start yet\",\n    text: \"Send a scope change with the extra time you need. The client approves it before you begin, so the extra hours are paid rather than worked free.\" },\n  { value: \"damage\", label: \"Something broke\", heading: \"Photograph it before you touch it\",\n    text: \"Take photos of the damage, then report it. Homlle routes the claim to your insurer — never agree a cash settlement with the client.\" },\n  { value: \"safety\", label: \"Safety concern\", heading: \"Leave now if you feel unsafe\", urgent: true,\n    text: \"Your safety comes before the clean. Call 999 in an emergency. Report it afterwards and Homlle will not offer you this client again.\" },\n  { value: \"cancel\", label: \"I need to cancel\", heading: \"Tell us as early as you can\",\n    text: \"Homlle re-offers the job to other cleaners. Cancelling at short notice may affect how often you are offered work.\" },\n  { value: \"client-cancelled\", label: \"Client cancelled late\", heading: \"Get it on record\",\n    text: \"Report it so the late cancellation sits against the booking, not just in the chat thread.\" },\n  { value: \"off-platform\", label: \"Client asked to pay cash\", heading: \"Keep it on Homlle\", urgent: true,\n    text: \"Paying off-platform voids your insurance and your protection if anything goes wrong. Report the request — it is not held against you.\" },\n  { value: \"other\", label: \"Other\", heading: \"Tell us in your own words\",\n    text: \"Describe what happened and Homlle Support will pick it up from here.\" }\n];\n\nconst REASONS = [\n  \"Too far to travel\",\n  \"Not free at that time\",\n  \"Pay too low for the work\",\n  \"Outside my specialisms\",\n  \"Something looks wrong\"\n];\n\nconst STEPS = [\n  { title: \"Personal details\", done: true },\n  { title: \"Business details\", done: false },\n  { title: \"Banking & payments\", done: false },\n  { title: \"Identity verification\", done: false },\n  { title: \"Right to work\", done: false },\n  { title: \"Background checks (DBS)\", done: false },\n  { title: \"Skills and Experience\", done: true },\n  { title: \"Insurance\", done: false },\n  { title: \"Equipment & Travel\", done: false },\n  { title: \"Work areas\", done: true },\n  { title: \"Skills\", done: false },\n  { title: \"Training & certificates\", done: false },\n  { title: \"Compliance & declarations\", done: false },\n  { title: \"Review & submit\", done: false }\n];\n\nclass Component extends DCLogic {\n  state = { route: (window.location.hash || \"#activity\").slice(1) || \"activity\", thread: 0,\n    offer: 0, decline: false, reason: null, decided: null, elapsed: 0,\n    incident: \"\", reported: false, week: 0,\n    stage: 0, stamps: {}, ticked: {},\n    // ?embed=1 is the phone-width copy of this page: it renders the shell only\n    embedded: /[?&]embed=1/.test(window.location.search) };\n\n  componentDidMount() {\n    /* The seam in one line: swap MOCK_BOOKINGS for list_my_booking_summaries\n     * and re-point this at ./booking-summary-model.js to go live. */\n    import(\"./homlle-booking.js\").then((mod) => {\n      BOOKING = mod;\n      this.forceUpdate();\n    }).catch(() => { BOOKING = null; });\n    this.timer = setInterval(() => this.setState((st) => ({ elapsed: st.elapsed + 1 })), 1000);\n    this.onHash = () => {\n      const next = (window.location.hash || \"#activity\").slice(1) || \"activity\";\n      this.setState({ route: PAGES[next] ? next : \"activity\" });\n      const main = this.el && this.el.querySelector ? this.el.querySelector(\"main\") : null;\n      if (main) main.scrollTop = 0;\n    };\n    window.addEventListener(\"hashchange\", this.onHash);\n  }\n\n  componentWillUnmount() {\n    window.removeEventListener(\"hashchange\", this.onHash);\n    clearInterval(this.timer);\n  }\n\n  money(n) { return \"£\" + n.toFixed(2); }\n\n  clock(secs) {\n    if (secs <= 0) return \"0m 00s\";\n    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;\n    const pad = (v) => String(v).padStart(2, \"0\");\n    return h > 0 ? h + \"h \" + pad(m) + \"m \" + pad(s) + \"s\" : m + \"m \" + pad(s) + \"s\";\n  }\n\n  setOffer(i) { this.setState({ offer: i, decline: false, reason: null, decided: null }); }\n\n  offerVals() {\n    const i = this.state.offer || 0;\n    const o = OFFERS[i];\n    const left = Math.max(0, o.expires - this.state.elapsed);\n    const urgent = left < 3600;\n    const chosen = this.state.reason;\n    const decided = this.state.decided;\n    return {\n      offerNum: i + 1,\n      offerTitle: o.title,\n      offerArea: o.area,\n      offerWhen: o.when,\n      offerHours: o.hours,\n      offerMiles: o.miles,\n      offerDrive: o.drive,\n      offerLeaveBy: o.leaveBy,\n      offerFrequency: o.frequency,\n      offerScope: o.scope.map((text) => ({ text })),\n      offerExtras: o.extras.map((text) => ({ text })),\n      payClient: this.money(o.client),\n      payFee: this.money(o.fee),\n      payNet: this.money(o.pay),\n      payRate: this.money(o.pay / o.hours) + \" an hour\",\n      countdown: this.clock(left),\n      expiryInk: urgent ? \"#a30c24\" : \"#201e1d\",\n      expiryEdge: urgent ? \"#e01030\" : \"rgba(32,30,29,.4)\",\n      expiryFill: urgent ? \"rgba(224,16,48,.08)\" : \"transparent\",\n      offerTabs: OFFERS.map((x, n) => ({\n        label: \"Offer \" + (n + 1),\n        bg: n === i ? \"#201e1d\" : \"transparent\",\n        ink: n === i ? \"#fff\" : \"#201e1d\",\n        select: () => this.setOffer(n)\n      })),\n      showDecide: !decided && !this.state.decline,\n      showDecline: !decided && Boolean(this.state.decline),\n      showAccepted: decided === \"accepted\",\n      showDeclined: decided === \"declined\",\n      declinedReason: chosen || \"no reason given\",\n      reasons: REASONS.map((label) => ({\n        label,\n        edge: chosen === label ? \"#201e1d\" : \"rgba(32,30,29,.4)\",\n        bg: chosen === label ? \"rgba(32,30,29,.06)\" : \"#fff\",\n        ink: chosen === label ? \"#201e1d\" : \"rgba(32,30,29,.8)\",\n        dot: chosen === label ? \"#e01030\" : \"transparent\",\n        dotEdge: chosen === label ? \"#e01030\" : \"rgba(32,30,29,.45)\",\n        select: () => this.setState({ reason: label })\n      })),\n      confirmLabel: chosen ? \"Confirm decline\" : \"Pick a reason first\",\n      confirmFill: chosen ? \"#201e1d\" : \"rgba(32,30,29,.12)\",\n      confirmInk: chosen ? \"#fff\" : \"rgba(32,30,29,.72)\",\n      confirmCursor: chosen ? \"pointer\" : \"not-allowed\",\n      acceptOffer: () => this.setState({ decided: \"accepted\", decline: false }),\n      openDecline: () => this.setState({ decline: true }),\n      cancelDecline: () => this.setState({ decline: false, reason: null }),\n      confirmDecline: () => { if (this.state.reason) this.setState({ decided: \"declined\", decline: false }); },\n      resetOffer: () => this.setState({ decided: null, decline: false, reason: null })\n    };\n  }\n\n  weekVals() {\n    const w = Math.max(0, Math.min(WEEKS.length - 1, this.state.week || 0));\n    const wk = WEEKS[w];\n    const first = w === 0, last = w === WEEKS.length - 1;\n    // OFFERS is the live pending set — the same two the map and YOUR STATUS report,\n    // whichever week is on screen. Only money, hours, hero and the job list page.\n    const pending = OFFERS.length;\n    const offerDays = OFFERS.map((o) => o.when.split(\" · \")[0]).join(\" and \");\n    return {\n      weekLabel: wk.label,\n      weekLabelShort: wk.short,\n      weekNote: wk.note,\n      weekValue: \"£\" + wk.value.toFixed(2),\n      weekValueInk: wk.value ? \"#201e1d\" : \"rgba(32,30,29,.5)\",\n      weekHours: wk.hours,\n      weekHoursInk: wk.hours === \"0\" ? \"rgba(32,30,29,.5)\" : \"#201e1d\",\n      nextValue: last ? \"—\" : \"£\" + WEEKS[w + 1].value.toFixed(2),\n      nextValueInk: (!last && WEEKS[w + 1].value) ? \"#201e1d\" : \"rgba(32,30,29,.5)\",\n      nextValueNote: last ? \"no week loaded\" : \"confirmed in \" + WEEKS[w + 1].short,\n      offersCount: pending || \"0\",\n      offersNote: pending ? pending + \" awaiting your reply\" : \"none awaiting reply\",\n      offersEdge: pending ? \"#e01030\" : \"#2d2b2a\",\n      offersInk: pending ? \"#a30c24\" : \"rgba(32,30,29,.5)\",\n      offersLine: (pending === 2 ? \"Two offers are\" : pending + \" offer is\") + \" waiting on your reply — \" + offerDays + \".\",\n      weekHasOffers: pending > 0,\n      weekHasJob: Boolean(wk.hero),\n      weekNoJob: !wk.hero,\n      heroBadge: wk.hero ? wk.hero.badge : wk.emptyBadge,\n      heroTitle: wk.hero ? wk.hero.title : wk.emptyTitle,\n      heroArea: wk.hero ? wk.hero.area : \"\",\n      heroHours: wk.hero ? wk.hero.hours : \"\",\n      heroPay: wk.hero ? wk.hero.pay : \"\",\n      heroEmptyLine: wk.emptyLine || \"\",\n      weekJobs: wk.jobs,\n      weekDays: wk.days.map((state, n) => ({\n        name: DAYS[n],\n        fill: state === 2 ? \"#e01030\" : (state === 1 ? \"rgba(224,16,48,.12)\" : \"rgba(32,30,29,.1)\"),\n        ring: state === 2 ? \"inset 0 0 0 3px #201e1d\" : (state === 1 ? \"inset 0 0 0 2px #e01030\" : \"none\"),\n        ink: state === 0 ? \"rgba(32,30,29,.72)\" : \"#201e1d\",\n        aria: DAYS[n] + \" \" + wk.label + \" — \" +\n          (state === 2 ? \"one clean booked. Open jobs near you\"\n            : state === 1 ? \"an offer awaiting your reply. Open jobs near you\"\n            : \"nothing booked. Open jobs near you\")\n      })),\n      prevWeek: () => this.setState((st) => ({ week: Math.max(0, (st.week || 0) - 1) })),\n      nextWeek: () => this.setState((st) => ({ week: Math.min(WEEKS.length - 1, (st.week || 0) + 1) })),\n      prevEdge: first ? \"rgba(32,30,29,.25)\" : \"#201e1d\",\n      prevInk: first ? \"rgba(32,30,29,.4)\" : \"#201e1d\",\n      prevCursor: first ? \"not-allowed\" : \"pointer\",\n      nextEdge: last ? \"rgba(32,30,29,.25)\" : \"#201e1d\",\n      nextInk: last ? \"rgba(32,30,29,.4)\" : \"#201e1d\",\n      nextCursor: last ? \"not-allowed\" : \"pointer\"\n    };\n  }\n\n  jobVals() {\n    const stage = this.state.stage || 0;\n    const stamps = this.state.stamps || {};\n    const ticked = this.state.ticked || {};\n    const flat = [];\n    ROOMS.forEach((room, ri) => room.items.forEach((label, ii) => flat.push({ key: ri + \"-\" + ii, label, ri })));\n    const doneCount = flat.filter((t) => ticked[t.key]).length;\n    const allTicked = doneCount === flat.length;\n    const finished = stage >= STAGES.length - 1;\n    const working = stage >= 3;\n    const unresolved = flat.length - doneCount;\n    const status = STAGES[stage].status;\n\n    /* Everything below is asked of the shared module rather than restated here,\n     * so an upstream label or rule change reaches this screen automatically. */\n    const label = (st) => (BOOKING ? BOOKING.activeJobStatusLabels[st] : FALLBACK_LABEL[st]) || \"\";\n    const action = BOOKING\n      ? BOOKING.activeJobAction(\"cleaner\",\n          { status },\n          { status, totalTasks: flat.length, resolvedTasks: doneCount },\n          { checked: true, canStartJourney: true })\n      : { label: FALLBACK_ACTION[status] || \"\", enabled: status !== \"cleaning-in-progress\" || allTicked };\n    /* The real rule: ticking is possible only while cleaning is in progress. */\n    const canTick = BOOKING ? BOOKING.taskCanBeUpdated(\"cleaner\", status) : status === \"cleaning-in-progress\";\n\n    const checks = [{ label: allTicked ? \"All \" + flat.length + \" tasks resolved\" : action.label, ok: allTicked }];\n    const ready = working && allTicked;\n    const record = { participantRole: \"cleaner\", status, pricePence: 6800 };\n    const statusLabel = BOOKING ? BOOKING.bookingSummaryStatusLabels[status] : \"\";\n    const moneyNote = BOOKING\n      ? BOOKING.bookingSummaryMoneyBoundary(record, \"cleaner\")\n      : \"This is your agreed Cleaner pay, not a payout receipt. Transfer status is verified separately after completion.\";\n    return {\n      jobStatus: status,\n      jobStatusLabel: statusLabel,\n      jobMoneyNote: moneyNote,\n      stageTitle: label(status),\n      stageNote: STAGES[stage].note,\n      stageAction: action.label,\n      stageHasAction: Boolean(action.label) && status !== \"awaiting-review\",\n      stageActionBlocked: !action.enabled,\n      stageActionFill: action.enabled ? \"#201e1d\" : \"rgba(32,30,29,.12)\",\n      stageActionInk: action.enabled ? \"#fff\" : \"rgba(32,30,29,.72)\",\n      stageActionCursor: action.enabled ? \"pointer\" : \"not-allowed\",\n      stageCanReset: stage > 0,\n      journey: STAGES.map((st, n) => ({\n        label: label(st.status),\n        time: n === 0 ? \"\" : (stamps[n] || (n === stage ? \"now\" : \"\")),\n        tick: n < stage ? \"✓\" : \"\",\n        fill: n < stage ? \"#e01030\" : (n === stage ? \"#201e1d\" : \"transparent\"),\n        ring: n <= stage ? \"0\" : \"2px solid rgba(32,30,29,.3)\",\n        railFill: n < stage ? \"#e01030\" : \"rgba(32,30,29,.18)\",\n        rail: n === STAGES.length - 1 ? \"0px\" : \"14px\",\n        ink: n <= stage ? \"#201e1d\" : \"rgba(32,30,29,.72)\"\n      })),\n      advanceStage: () => this.setState((st) => {\n        if (!action.enabled) return null;\n        const next = Math.min(STAGES.length - 1, (st.stage || 0) + 1);\n        const time = new Date().toLocaleTimeString(\"en-GB\", { hour: \"2-digit\", minute: \"2-digit\" });\n        return { stage: next, stamps: { ...(st.stamps || {}), [next]: time } };\n      }),\n      resetStage: () => this.setState({ stage: 0, stamps: {} }),\n      taskTotal: flat.length,\n      taskDone: doneCount,\n      taskPct: Math.round((doneCount / flat.length) * 100) + \"%\",\n      rooms: ROOMS.map((room, ri) => {\n        const items = room.items.map((label, ii) => {\n          const key = ri + \"-\" + ii;\n          const on = Boolean(ticked[key]);\n          return {\n            label, pressed: on ? \"true\" : \"false\",\n            edge: on ? \"#e01030\" : \"rgba(32,30,29,.4)\",\n            fill: on ? \"#e01030\" : \"transparent\",\n            tickInk: on ? \"#fff\" : \"transparent\",\n            ink: on ? \"rgba(32,30,29,.72)\" : \"#201e1d\",\n            strike: on ? \"line-through\" : \"none\",\n            toggle: () => { if (!canTick) return; this.setState((st) => {\n              const map = { ...(st.ticked || {}) };\n              if (map[key]) delete map[key]; else map[key] = true;\n              return { ticked: map };\n            }); }\n          };\n        });\n        const n = room.items.filter((_, ii) => ticked[ri + \"-\" + ii]).length;\n        return { name: room.name, items, count: n + \"/\" + room.items.length,\n          ink: n === room.items.length ? \"#a30c24\" : \"rgba(32,30,29,.72)\" };\n      }),\n      taskLocked: !canTick,\n      taskEditable: canTick,\n      taskCursor: canTick ? \"pointer\" : \"default\",\n      taskLockNote: finished\n        ? \"Submitted as evidence. The checklist locks once cleaning is finished, so it still matches what the Landlord was sent.\"\n        : \"The checklist opens when you start cleaning. Homlle only accepts ticks while the booking is in progress.\",\n      tickAll: () => this.setState(() => {\n        const map = {};\n        flat.forEach((t) => { map[t.key] = true; });\n        return { ticked: map };\n      }),\n      clearAll: () => this.setState({ ticked: {} }),\n      finishChecks: checks.map((c) => ({\n        label: c.label,\n        edge: c.ok ? \"#e01030\" : \"rgba(32,30,29,.4)\",\n        fill: c.ok ? \"#e01030\" : \"transparent\",\n        tickInk: c.ok ? \"#fff\" : \"transparent\",\n        ink: c.ok ? \"#201e1d\" : \"rgba(32,30,29,.7)\"\n      })),\n      finishTitle: finished ? label(\"awaiting-review\") : (ready ? \"Ready to finish\" : \"Not ready yet\"),\n      finishEdge: finished ? \"#2d2b2a\" : (ready ? \"#e01030\" : \"#2d2b2a\"),\n      finishLabel: finished ? \"Cleaning complete\" : (working ? action.label : \"Start cleaning first\"),\n      finishFill: ready && !finished ? \"#e01030\" : \"rgba(32,30,29,.12)\",\n      finishInk: ready && !finished ? \"#fff\" : \"rgba(32,30,29,.72)\",\n      finishCursor: ready && !finished ? \"pointer\" : \"not-allowed\",\n      finishJob: () => { if (ready && !finished) this.setState({ stage: STAGES.length - 1 }); },\n      jobFinished: finished\n    };\n  }\n\n  incidentVals() {\n    const chosen = INCIDENTS.find((x) => x.value === this.state.incident);\n    const sent = Boolean(this.state.reported) && Boolean(chosen);\n    return {\n      incident: this.state.incident,\n      incidentOptions: INCIDENTS.map((x) => ({ value: x.value, label: x.label })),\n      incidentPicked: Boolean(chosen),\n      incidentOther: this.state.incident === \"other\",\n      incidentLabel: chosen ? chosen.label : \"\",\n      incidentHeading: chosen ? chosen.heading : \"\",\n      incidentGuidance: chosen ? chosen.text : \"\",\n      incidentGlyph: chosen && chosen.urgent ? \"M12 4l9 16H3zM12 10v4M12 17h.01\" : \"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v.01M12 11v5\",\n      incidentInk: chosen && chosen.urgent ? \"#a30c24\" : \"#201e1d\",\n      incidentFill: chosen && chosen.urgent ? \"rgba(224,16,48,.09)\" : \"rgba(32,30,29,.06)\",\n      reportSent: sent,\n      reportLabel: sent ? \"Reported to Homlle\" : (chosen ? \"Report to Homlle\" : \"Choose a reason first\"),\n      reportFill: chosen ? (sent ? \"rgba(32,30,29,.12)\" : \"#e01030\") : \"rgba(32,30,29,.12)\",\n      reportInk: chosen && !sent ? \"#fff\" : \"rgba(32,30,29,.72)\",\n      reportCursor: chosen && !sent ? \"pointer\" : \"not-allowed\",\n      pickIncident: (e) => this.setState({ incident: e.target.value, reported: false }),\n      sendReport: () => { if (this.state.incident) this.setState({ reported: true }); },\n      clearReport: () => this.setState({ reported: false, incident: \"\" })\n    };\n  }\n\n  renderVals() {\n    const r = PAGES[this.state.route] ? this.state.route : \"activity\";\n    const page = PAGES[r];\n    const on = (key) => (r === key ? \"#fff\" : \"transparent\");\n    const ink = (key) => (r === key ? \"#201e1d\" : \"#fff\");\n    return {\n      kicker: r === \"activity\" ? WEEKS[Math.max(0, Math.min(WEEKS.length - 1, this.state.week || 0))].label : page.kicker,\n      pageTitle: page.title,\n      pageSub: page.sub,\n      isActivity: r === \"activity\",\n      isMap: r === \"jobs-map\",\n      isMessages: r === \"messages\",\n      isEarnings: r === \"earnings\",\n      isPerformance: r === \"performance\",\n      isProfile: r === \"profile\",\n      isReviews: r === \"reviews\",\n      isJob: r === \"job\",\n      navReviews: (r === \"reviews\" || r === \"performance\") ? \"#fff\" : \"transparent\",\n      inkReviews: (r === \"reviews\" || r === \"performance\") ? \"#201e1d\" : \"#fff\",\n      navActivity: on(\"activity\"), inkActivity: ink(\"activity\"),\n      navMap: on(\"jobs-map\"), inkMap: ink(\"jobs-map\"),\n      navMsg: on(\"messages\"), inkMsg: ink(\"messages\"),\n      navPay: on(\"earnings\"), inkPay: ink(\"earnings\"),\n      navPerf: on(\"performance\"), inkPerf: ink(\"performance\"),\n      navProfile: on(\"profile\"), inkProfile: ink(\"profile\"),\n      threads: THREADS.map((t, i) => ({\n        name: t.name, preview: t.preview, when: t.when, initial: t.initial,\n        bg: i === (this.state.thread || 0) ? \"rgba(224,16,48,.06)\" : \"transparent\",\n        edge: i === (this.state.thread || 0) ? \"4px solid #e01030\" : \"4px solid transparent\",\n        select: () => this.setState({ thread: i })\n      })),\n      chatInitial: THREADS[this.state.thread || 0].initial,\n      chatName: THREADS[this.state.thread || 0].name,\n      chatMessages: THREADS[this.state.thread || 0].messages.map((m) => ({\n        text: m.me || m.them, fromMe: Boolean(m.me), fromThem: Boolean(m.them)\n      })),\n      pickOffer0: () => this.setOffer(0),\n      pickOffer1: () => this.setOffer(1),\n      steps: STEPS.map((st) => ({\n        title: st.title,\n        tick: st.done ? \"✓\" : \"\",\n        mark: st.done ? \"#ee352c\" : \"transparent\",\n        ring: st.done ? \"0\" : \"2px solid rgba(32,30,29,.32)\",\n        state: st.done ? \"RECORDED\" : \"OUTSTANDING\"\n      })),\n      ...this.offerVals(),\n      showChrome: !this.state.embedded,\n      ...this.weekVals(),\n      ...this.jobVals(),\n      ...this.incidentVals(),\n      accountNav: ACCOUNT.map((a) => ({ ...a, live: !a.note, inert: Boolean(a.note), ink: a.label === \"Logout\" ? \"#a30c24\" : \"#201e1d\" }))\n    };\n  }\n}": function(DCLogic,StreamableLogic,React){

const ICON = {
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5",
  bell: "M6 16v-5a6 6 0 1 1 12 0v5l2 3H4zM10 19a2 2 0 0 0 4 0",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.7 2.7 0 1 1 4.1 2.3c-1 .7-1.6 1.1-1.6 2.2M12 17h.01",
  chat: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
  shield: "M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6zM9 12l2 2 4-4",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1",
  logout: "M10 4H5v16h5M14 8l4 4-4 4M18 12H9"
};

const PAGES = {
  activity:    { kicker: "31 AUG – 6 SEPT", title: "Activity schedule", sub: "See selected work by week, then review every clean's price, area, type and property images below." },
  "jobs-map":  { kicker: "YOUR WORK AREAS", title: "Jobs near you", sub: "Explore available jobs by area, then review the full clean details before deciding." },
  messages:    { kicker: "PRIVATE BOOKING CONVERSATIONS", title: "Messages", sub: "Chat with clients and the Homlle team. Numbers stay private — everything goes through the app." },
  earnings:    { kicker: "CLEANER PAYOUTS", title: "Earnings", sub: "Agreed Cleaner pay on completed jobs, and how payouts get set up." },
  performance: { kicker: "RATING & BADGES", title: "Performance", sub: "Clients rate every completed job. Ratings drive how often you're offered work." },
  profile:     { kicker: "YOUR PUBLIC PROFILE", title: "Your public profile", sub: "Exactly what clients see when Homlle offers them your profile. It updates live as you edit your registration." },
  reviews:     { kicker: "REVIEWS & RATINGS", title: "Reviews & ratings", sub: "Clients rate every completed job. Ratings drive how often you're offered work." },
  job:         { kicker: "CONFIRMED VISIT", title: "Deep clean · 3 bed house", sub: "Sun 6 Sept · 09:00 · LS6 · 3.5 hours · £68.00 agreed Cleaner pay." }
};

const ACCOUNT = [
  { label: "My Profile", icon: ICON.user, href: "#profile", note: "CURRENT PAGE" },
  { label: "Notifications", icon: ICON.bell, href: "#profile", note: "NOT IN THIS PASS" },
  { label: "Help Centre", icon: ICON.help, href: "#profile", note: "NOT IN THIS PASS" },
  { label: "Support Tickets", icon: ICON.chat, href: "#profile", note: "NOT IN THIS PASS" },
  { label: "Report an Incident", icon: ICON.shield, href: "#profile", note: "NOT IN THIS PASS" },
  { label: "My Disputes", icon: ICON.shield, href: "#profile", note: "NOT IN THIS PASS" },
  { label: "Settings", icon: ICON.gear, href: "#profile", note: "NOT IN THIS PASS" },
  { label: "Logout", icon: ICON.logout, href: "", note: "SIGNS OUT TO /LOGIN" }
];

const THREADS = [
  { name: "Jordan · LS6 deep clean", preview: "Perfect. Oven's the main thing if you have time.", when: "09:12", initial: "J",
    messages: [
      { them: "Morning! The key is in the lockbox, code is on your job sheet." },
      { me: "On my way" },
      { them: "Perfect. Oven's the main thing if you have time." }
    ] },
  { name: "Homlle Support", preview: "Your insurance certificate is still outstanding.", when: "Fri", initial: "H",
    messages: [
      { them: "Your insurance certificate is still outstanding." },
      { them: "Upload it on the Insurance step and we'll review it within two working days." }
    ] },
  { name: "Priya · LS1", preview: "Thanks for accepting — see you Tuesday at one.", when: "Thu", initial: "P",
    messages: [
      { me: "Happy to take Tuesday at one." },
      { them: "Thanks for accepting — see you Tuesday at one." }
    ] }
];

const OFFERS = [
  { title: "Regular clean · 2 bed flat", area: "LS1", when: "Tue 8 Sept · 13:00–15:00",
    hours: 2, miles: "4.1", drive: "14 min", leaveBy: "12:40", frequency: "One-off",
    client: 45, fee: 9, pay: 36, expires: 3 * 3600 + 42 * 60,
    scope: ["Kitchen — surfaces, hob, sink, floor", "Bathroom — bath, shower, WC, mirror", "Two bedrooms — dust and vacuum", "Living room — dust, vacuum, tidy"],
    extras: ["Client provides all products and equipment.", "Key is in a lockbox — the code appears once you accept."] },
  { title: "End of tenancy", area: "LS2", when: "Thu 10 Sept · 10:00–15:00",
    hours: 5, miles: "6.8", drive: "22 min", leaveBy: "09:30", frequency: "One-off",
    client: 118.75, fee: 23.75, pay: 95, expires: 21 * 3600 + 6 * 60,
    scope: ["Whole two-bed flat, empty of furniture", "Oven deep clean, inside and out", "Windows inside, sills and frames", "Skirtings, doors and light switches", "Carpets vacuumed throughout"],
    extras: ["You bring your own products and equipment.", "The letting agent meets you on arrival."] }
];

/* Every status, label and action label below is verbatim from
 * public/active-job-model.js — `activeJobStages`, `activeJobStatusLabels` and
 * the descriptors `activeJobAction()` returns for the cleaner role. The notes
 * are the only authored strings here.
 *
 * Two label maps exist for the same statuses and they are not interchangeable:
 * activeJobStatusLabels (this screen, both roles watching the job) says
 * "Cleaning finished" for awaiting-review, while bookingSummaryStatusLabels
 * (the booking lists) says "Awaiting review". Use the map that owns the surface.
 *
 * `completed` is deliberately absent: the Landlord confirms it, so the Cleaner
 * screen stops at awaiting-review. */
const STAGES = [
  { status: "confirmed",
    note: "Set off and tell the client — they see you are travelling, not your location." },
  { status: "cleaner-en-route",
    note: "The client can see you are travelling. Message them if you are held up." },
  { status: "cleaner-arrived",
    note: "Check you can get in and that the job matches the description before you start." },
  { status: "cleaning-in-progress",
    note: "Tick each task as you finish it. The client sees progress, not the ticks themselves." },
  { status: "awaiting-review",
    note: "Waiting for Landlord confirmation. Your completed checklist and evidence are ready for them to review." }
];

/* Shown only until import("./homlle-booking.js") resolves. If a label here ever
 * differs from the module's, the module wins — these are never authoritative. */
const FALLBACK_LABEL = {
  confirmed: "Booking confirmed",
  "cleaner-en-route": "Cleaner en route",
  "cleaner-arrived": "Cleaner arrived",
  "cleaning-in-progress": "Cleaning in progress",
  "awaiting-review": "Cleaning finished"
};
const FALLBACK_ACTION = {
  confirmed: "Start journey",
  "cleaner-en-route": "I have arrived",
  "cleaner-arrived": "Start cleaning",
  "cleaning-in-progress": "Finish cleaning"
};

const ROOMS = [
  { name: "KITCHEN", items: ["Worktops and splashback", "Hob and extractor", "Sink and taps", "Inside the oven", "Floor"] },
  { name: "BATHROOM", items: ["Bath and shower", "WC", "Sink and mirror", "Tiles and grout", "Floor"] },
  { name: "THREE BEDROOMS", items: ["Dust all surfaces", "Change the bedding", "Vacuum"] },
  { name: "LIVING ROOM", items: ["Dust and polish", "Vacuum", "Tidy and cushions"] },
  { name: "HALL AND STAIRS", items: ["Vacuum", "Skirtings and switches"] }
];

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const WEEKS = [
  { label: "31 AUG – 6 SEPT", short: "this week",
    note: "One clean booked today, outlined. Tap any day to see jobs going in your areas.",
    days: [0, 0, 0, 0, 0, 0, 2],
    value: 68, hours: "3.5",
    hero: { badge: "TODAY · 09:00", title: "Deep clean · 3 bed house", area: "LS6", hours: "3.5", pay: "£68.00" },
    jobs: [{ title: "Deep clean · 3 bed house", meta: "Sun 6 Sept · 09:00 · LS6 · 3.5 hours · confirmed", pay: "£68.00" }] },
  { label: "7 – 13 SEPT", short: "week of 7 Sept",
    note: "Two offers are waiting on your reply — nothing confirmed yet. Tap a day to open the map.",
    days: [0, 1, 0, 1, 0, 0, 0],
    value: 0, hours: "0",
    hero: null, emptyBadge: "NOTHING CONFIRMED", emptyTitle: "Two offers, no bookings",
    emptyLine: "Reply to the offers on Tue 8 and Thu 10 and they land in this week.",
    jobs: [] },
  { label: "14 – 20 SEPT", short: "week of 14 Sept",
    note: "Nothing booked yet. Jobs in your work areas appear on the map as clients post them.",
    days: [0, 0, 0, 0, 0, 0, 0],
    value: 0, hours: "0",
    hero: null, emptyBadge: "NOTHING BOOKED", emptyTitle: "This week is open",
    emptyLine: "Nothing offered for this week yet. Widening your travel radius brings more work in.",
    jobs: [] }
];

/* The seam. `homlle-booking.js` owns the booking record and the pure functions
 * over it; the Landlord view is a second consumer of the same module. Loading
 * it here proves the boundary instead of describing it. */
let BOOKING = null;

const INCIDENTS = [
  { value: "access", label: "Can't get in", heading: "Message the client first",
    text: "Wait at the property and message the client. If there is no reply after 15 minutes, report it here — Homlle logs your arrival so waiting time can be considered." },
  { value: "scope", label: "Job is bigger than described", heading: "Do not start yet",
    text: "Send a scope change with the extra time you need. The client approves it before you begin, so the extra hours are paid rather than worked free." },
  { value: "damage", label: "Something broke", heading: "Photograph it before you touch it",
    text: "Take photos of the damage, then report it. Homlle routes the claim to your insurer — never agree a cash settlement with the client." },
  { value: "safety", label: "Safety concern", heading: "Leave now if you feel unsafe", urgent: true,
    text: "Your safety comes before the clean. Call 999 in an emergency. Report it afterwards and Homlle will not offer you this client again." },
  { value: "cancel", label: "I need to cancel", heading: "Tell us as early as you can",
    text: "Homlle re-offers the job to other cleaners. Cancelling at short notice may affect how often you are offered work." },
  { value: "client-cancelled", label: "Client cancelled late", heading: "Get it on record",
    text: "Report it so the late cancellation sits against the booking, not just in the chat thread." },
  { value: "off-platform", label: "Client asked to pay cash", heading: "Keep it on Homlle", urgent: true,
    text: "Paying off-platform voids your insurance and your protection if anything goes wrong. Report the request — it is not held against you." },
  { value: "other", label: "Other", heading: "Tell us in your own words",
    text: "Describe what happened and Homlle Support will pick it up from here." }
];

const REASONS = [
  "Too far to travel",
  "Not free at that time",
  "Pay too low for the work",
  "Outside my specialisms",
  "Something looks wrong"
];

const STEPS = [
  { title: "Personal details", done: true },
  { title: "Business details", done: false },
  { title: "Banking & payments", done: false },
  { title: "Identity verification", done: false },
  { title: "Right to work", done: false },
  { title: "Background checks (DBS)", done: false },
  { title: "Skills and Experience", done: true },
  { title: "Insurance", done: false },
  { title: "Equipment & Travel", done: false },
  { title: "Work areas", done: true },
  { title: "Skills", done: false },
  { title: "Training & certificates", done: false },
  { title: "Compliance & declarations", done: false },
  { title: "Review & submit", done: false }
];

class Component extends DCLogic {
  state = { route: (window.location.hash || "#activity").slice(1) || "activity", thread: 0,
    offer: 0, decline: false, reason: null, decided: null, elapsed: 0,
    incident: "", reported: false, week: 0,
    stage: 0, stamps: {}, ticked: {},
    // ?embed=1 is the phone-width copy of this page: it renders the shell only
    embedded: /[?&]embed=1/.test(window.location.search) };

  componentDidMount() {
    /* The seam in one line: swap MOCK_BOOKINGS for list_my_booking_summaries
     * and re-point this at ./booking-summary-model.js to go live. */
    import("./homlle-booking.js").then((mod) => {
      BOOKING = mod;
      this.forceUpdate();
    }).catch(() => { BOOKING = null; });
    this.timer = setInterval(() => this.setState((st) => ({ elapsed: st.elapsed + 1 })), 1000);
    this.onHash = () => {
      const next = (window.location.hash || "#activity").slice(1) || "activity";
      this.setState({ route: PAGES[next] ? next : "activity" });
      const main = this.el && this.el.querySelector ? this.el.querySelector("main") : null;
      if (main) main.scrollTop = 0;
    };
    window.addEventListener("hashchange", this.onHash);
  }

  componentWillUnmount() {
    window.removeEventListener("hashchange", this.onHash);
    clearInterval(this.timer);
  }

  money(n) { return "£" + n.toFixed(2); }

  clock(secs) {
    if (secs <= 0) return "0m 00s";
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    const pad = (v) => String(v).padStart(2, "0");
    return h > 0 ? h + "h " + pad(m) + "m " + pad(s) + "s" : m + "m " + pad(s) + "s";
  }

  setOffer(i) { this.setState({ offer: i, decline: false, reason: null, decided: null }); }

  offerVals() {
    const i = this.state.offer || 0;
    const o = OFFERS[i];
    const left = Math.max(0, o.expires - this.state.elapsed);
    const urgent = left < 3600;
    const chosen = this.state.reason;
    const decided = this.state.decided;
    return {
      offerNum: i + 1,
      offerTitle: o.title,
      offerArea: o.area,
      offerWhen: o.when,
      offerHours: o.hours,
      offerMiles: o.miles,
      offerDrive: o.drive,
      offerLeaveBy: o.leaveBy,
      offerFrequency: o.frequency,
      offerScope: o.scope.map((text) => ({ text })),
      offerExtras: o.extras.map((text) => ({ text })),
      payClient: this.money(o.client),
      payFee: this.money(o.fee),
      payNet: this.money(o.pay),
      payRate: this.money(o.pay / o.hours) + " an hour",
      countdown: this.clock(left),
      expiryInk: urgent ? "#a30c24" : "#201e1d",
      expiryEdge: urgent ? "#e01030" : "rgba(32,30,29,.4)",
      expiryFill: urgent ? "rgba(224,16,48,.08)" : "transparent",
      offerTabs: OFFERS.map((x, n) => ({
        label: "Offer " + (n + 1),
        bg: n === i ? "#201e1d" : "transparent",
        ink: n === i ? "#fff" : "#201e1d",
        select: () => this.setOffer(n)
      })),
      showDecide: !decided && !this.state.decline,
      showDecline: !decided && Boolean(this.state.decline),
      showAccepted: decided === "accepted",
      showDeclined: decided === "declined",
      declinedReason: chosen || "no reason given",
      reasons: REASONS.map((label) => ({
        label,
        edge: chosen === label ? "#201e1d" : "rgba(32,30,29,.4)",
        bg: chosen === label ? "rgba(32,30,29,.06)" : "#fff",
        ink: chosen === label ? "#201e1d" : "rgba(32,30,29,.8)",
        dot: chosen === label ? "#e01030" : "transparent",
        dotEdge: chosen === label ? "#e01030" : "rgba(32,30,29,.45)",
        select: () => this.setState({ reason: label })
      })),
      confirmLabel: chosen ? "Confirm decline" : "Pick a reason first",
      confirmFill: chosen ? "#201e1d" : "rgba(32,30,29,.12)",
      confirmInk: chosen ? "#fff" : "rgba(32,30,29,.72)",
      confirmCursor: chosen ? "pointer" : "not-allowed",
      acceptOffer: () => this.setState({ decided: "accepted", decline: false }),
      openDecline: () => this.setState({ decline: true }),
      cancelDecline: () => this.setState({ decline: false, reason: null }),
      confirmDecline: () => { if (this.state.reason) this.setState({ decided: "declined", decline: false }); },
      resetOffer: () => this.setState({ decided: null, decline: false, reason: null })
    };
  }

  weekVals() {
    const w = Math.max(0, Math.min(WEEKS.length - 1, this.state.week || 0));
    const wk = WEEKS[w];
    const first = w === 0, last = w === WEEKS.length - 1;
    // OFFERS is the live pending set — the same two the map and YOUR STATUS report,
    // whichever week is on screen. Only money, hours, hero and the job list page.
    const pending = OFFERS.length;
    const offerDays = OFFERS.map((o) => o.when.split(" · ")[0]).join(" and ");
    return {
      weekLabel: wk.label,
      weekLabelShort: wk.short,
      weekNote: wk.note,
      weekValue: "£" + wk.value.toFixed(2),
      weekValueInk: wk.value ? "#201e1d" : "rgba(32,30,29,.5)",
      weekHours: wk.hours,
      weekHoursInk: wk.hours === "0" ? "rgba(32,30,29,.5)" : "#201e1d",
      nextValue: last ? "—" : "£" + WEEKS[w + 1].value.toFixed(2),
      nextValueInk: (!last && WEEKS[w + 1].value) ? "#201e1d" : "rgba(32,30,29,.5)",
      nextValueNote: last ? "no week loaded" : "confirmed in " + WEEKS[w + 1].short,
      offersCount: pending || "0",
      offersNote: pending ? pending + " awaiting your reply" : "none awaiting reply",
      offersEdge: pending ? "#e01030" : "#2d2b2a",
      offersInk: pending ? "#a30c24" : "rgba(32,30,29,.5)",
      offersLine: (pending === 2 ? "Two offers are" : pending + " offer is") + " waiting on your reply — " + offerDays + ".",
      weekHasOffers: pending > 0,
      weekHasJob: Boolean(wk.hero),
      weekNoJob: !wk.hero,
      heroBadge: wk.hero ? wk.hero.badge : wk.emptyBadge,
      heroTitle: wk.hero ? wk.hero.title : wk.emptyTitle,
      heroArea: wk.hero ? wk.hero.area : "",
      heroHours: wk.hero ? wk.hero.hours : "",
      heroPay: wk.hero ? wk.hero.pay : "",
      heroEmptyLine: wk.emptyLine || "",
      weekJobs: wk.jobs,
      weekDays: wk.days.map((state, n) => ({
        name: DAYS[n],
        fill: state === 2 ? "#e01030" : (state === 1 ? "rgba(224,16,48,.12)" : "rgba(32,30,29,.1)"),
        ring: state === 2 ? "inset 0 0 0 3px #201e1d" : (state === 1 ? "inset 0 0 0 2px #e01030" : "none"),
        ink: state === 0 ? "rgba(32,30,29,.72)" : "#201e1d",
        aria: DAYS[n] + " " + wk.label + " — " +
          (state === 2 ? "one clean booked. Open jobs near you"
            : state === 1 ? "an offer awaiting your reply. Open jobs near you"
            : "nothing booked. Open jobs near you")
      })),
      prevWeek: () => this.setState((st) => ({ week: Math.max(0, (st.week || 0) - 1) })),
      nextWeek: () => this.setState((st) => ({ week: Math.min(WEEKS.length - 1, (st.week || 0) + 1) })),
      prevEdge: first ? "rgba(32,30,29,.25)" : "#201e1d",
      prevInk: first ? "rgba(32,30,29,.4)" : "#201e1d",
      prevCursor: first ? "not-allowed" : "pointer",
      nextEdge: last ? "rgba(32,30,29,.25)" : "#201e1d",
      nextInk: last ? "rgba(32,30,29,.4)" : "#201e1d",
      nextCursor: last ? "not-allowed" : "pointer"
    };
  }

  jobVals() {
    const stage = this.state.stage || 0;
    const stamps = this.state.stamps || {};
    const ticked = this.state.ticked || {};
    const flat = [];
    ROOMS.forEach((room, ri) => room.items.forEach((label, ii) => flat.push({ key: ri + "-" + ii, label, ri })));
    const doneCount = flat.filter((t) => ticked[t.key]).length;
    const allTicked = doneCount === flat.length;
    const finished = stage >= STAGES.length - 1;
    const working = stage >= 3;
    const unresolved = flat.length - doneCount;
    const status = STAGES[stage].status;

    /* Everything below is asked of the shared module rather than restated here,
     * so an upstream label or rule change reaches this screen automatically. */
    const label = (st) => (BOOKING ? BOOKING.activeJobStatusLabels[st] : FALLBACK_LABEL[st]) || "";
    const action = BOOKING
      ? BOOKING.activeJobAction("cleaner",
          { status },
          { status, totalTasks: flat.length, resolvedTasks: doneCount },
          { checked: true, canStartJourney: true })
      : { label: FALLBACK_ACTION[status] || "", enabled: status !== "cleaning-in-progress" || allTicked };
    /* The real rule: ticking is possible only while cleaning is in progress. */
    const canTick = BOOKING ? BOOKING.taskCanBeUpdated("cleaner", status) : status === "cleaning-in-progress";

    const checks = [{ label: allTicked ? "All " + flat.length + " tasks resolved" : action.label, ok: allTicked }];
    const ready = working && allTicked;
    const record = { participantRole: "cleaner", status, pricePence: 6800 };
    const statusLabel = BOOKING ? BOOKING.bookingSummaryStatusLabels[status] : "";
    const moneyNote = BOOKING
      ? BOOKING.bookingSummaryMoneyBoundary(record, "cleaner")
      : "This is your agreed Cleaner pay, not a payout receipt. Transfer status is verified separately after completion.";
    return {
      jobStatus: status,
      jobStatusLabel: statusLabel,
      jobMoneyNote: moneyNote,
      stageTitle: label(status),
      stageNote: STAGES[stage].note,
      stageAction: action.label,
      stageHasAction: Boolean(action.label) && status !== "awaiting-review",
      stageActionBlocked: !action.enabled,
      stageActionFill: action.enabled ? "#201e1d" : "rgba(32,30,29,.12)",
      stageActionInk: action.enabled ? "#fff" : "rgba(32,30,29,.72)",
      stageActionCursor: action.enabled ? "pointer" : "not-allowed",
      stageCanReset: stage > 0,
      journey: STAGES.map((st, n) => ({
        label: label(st.status),
        time: n === 0 ? "" : (stamps[n] || (n === stage ? "now" : "")),
        tick: n < stage ? "✓" : "",
        fill: n < stage ? "#e01030" : (n === stage ? "#201e1d" : "transparent"),
        ring: n <= stage ? "0" : "2px solid rgba(32,30,29,.3)",
        railFill: n < stage ? "#e01030" : "rgba(32,30,29,.18)",
        rail: n === STAGES.length - 1 ? "0px" : "14px",
        ink: n <= stage ? "#201e1d" : "rgba(32,30,29,.72)"
      })),
      advanceStage: () => this.setState((st) => {
        if (!action.enabled) return null;
        const next = Math.min(STAGES.length - 1, (st.stage || 0) + 1);
        const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        return { stage: next, stamps: { ...(st.stamps || {}), [next]: time } };
      }),
      resetStage: () => this.setState({ stage: 0, stamps: {} }),
      taskTotal: flat.length,
      taskDone: doneCount,
      taskPct: Math.round((doneCount / flat.length) * 100) + "%",
      rooms: ROOMS.map((room, ri) => {
        const items = room.items.map((label, ii) => {
          const key = ri + "-" + ii;
          const on = Boolean(ticked[key]);
          return {
            label, pressed: on ? "true" : "false",
            edge: on ? "#e01030" : "rgba(32,30,29,.4)",
            fill: on ? "#e01030" : "transparent",
            tickInk: on ? "#fff" : "transparent",
            ink: on ? "rgba(32,30,29,.72)" : "#201e1d",
            strike: on ? "line-through" : "none",
            toggle: () => { if (!canTick) return; this.setState((st) => {
              const map = { ...(st.ticked || {}) };
              if (map[key]) delete map[key]; else map[key] = true;
              return { ticked: map };
            }); }
          };
        });
        const n = room.items.filter((_, ii) => ticked[ri + "-" + ii]).length;
        return { name: room.name, items, count: n + "/" + room.items.length,
          ink: n === room.items.length ? "#a30c24" : "rgba(32,30,29,.72)" };
      }),
      taskLocked: !canTick,
      taskEditable: canTick,
      taskCursor: canTick ? "pointer" : "default",
      taskLockNote: finished
        ? "Submitted as evidence. The checklist locks once cleaning is finished, so it still matches what the Landlord was sent."
        : "The checklist opens when you start cleaning. Homlle only accepts ticks while the booking is in progress.",
      tickAll: () => this.setState(() => {
        const map = {};
        flat.forEach((t) => { map[t.key] = true; });
        return { ticked: map };
      }),
      clearAll: () => this.setState({ ticked: {} }),
      finishChecks: checks.map((c) => ({
        label: c.label,
        edge: c.ok ? "#e01030" : "rgba(32,30,29,.4)",
        fill: c.ok ? "#e01030" : "transparent",
        tickInk: c.ok ? "#fff" : "transparent",
        ink: c.ok ? "#201e1d" : "rgba(32,30,29,.7)"
      })),
      finishTitle: finished ? label("awaiting-review") : (ready ? "Ready to finish" : "Not ready yet"),
      finishEdge: finished ? "#2d2b2a" : (ready ? "#e01030" : "#2d2b2a"),
      finishLabel: finished ? "Cleaning complete" : (working ? action.label : "Start cleaning first"),
      finishFill: ready && !finished ? "#e01030" : "rgba(32,30,29,.12)",
      finishInk: ready && !finished ? "#fff" : "rgba(32,30,29,.72)",
      finishCursor: ready && !finished ? "pointer" : "not-allowed",
      finishJob: () => { if (ready && !finished) this.setState({ stage: STAGES.length - 1 }); },
      jobFinished: finished
    };
  }

  incidentVals() {
    const chosen = INCIDENTS.find((x) => x.value === this.state.incident);
    const sent = Boolean(this.state.reported) && Boolean(chosen);
    return {
      incident: this.state.incident,
      incidentOptions: INCIDENTS.map((x) => ({ value: x.value, label: x.label })),
      incidentPicked: Boolean(chosen),
      incidentOther: this.state.incident === "other",
      incidentLabel: chosen ? chosen.label : "",
      incidentHeading: chosen ? chosen.heading : "",
      incidentGuidance: chosen ? chosen.text : "",
      incidentGlyph: chosen && chosen.urgent ? "M12 4l9 16H3zM12 10v4M12 17h.01" : "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v.01M12 11v5",
      incidentInk: chosen && chosen.urgent ? "#a30c24" : "#201e1d",
      incidentFill: chosen && chosen.urgent ? "rgba(224,16,48,.09)" : "rgba(32,30,29,.06)",
      reportSent: sent,
      reportLabel: sent ? "Reported to Homlle" : (chosen ? "Report to Homlle" : "Choose a reason first"),
      reportFill: chosen ? (sent ? "rgba(32,30,29,.12)" : "#e01030") : "rgba(32,30,29,.12)",
      reportInk: chosen && !sent ? "#fff" : "rgba(32,30,29,.72)",
      reportCursor: chosen && !sent ? "pointer" : "not-allowed",
      pickIncident: (e) => this.setState({ incident: e.target.value, reported: false }),
      sendReport: () => { if (this.state.incident) this.setState({ reported: true }); },
      clearReport: () => this.setState({ reported: false, incident: "" })
    };
  }

  renderVals() {
    const r = PAGES[this.state.route] ? this.state.route : "activity";
    const page = PAGES[r];
    const on = (key) => (r === key ? "#fff" : "transparent");
    const ink = (key) => (r === key ? "#201e1d" : "#fff");
    return {
      kicker: r === "activity" ? WEEKS[Math.max(0, Math.min(WEEKS.length - 1, this.state.week || 0))].label : page.kicker,
      pageTitle: page.title,
      pageSub: page.sub,
      isActivity: r === "activity",
      isMap: r === "jobs-map",
      isMessages: r === "messages",
      isEarnings: r === "earnings",
      isPerformance: r === "performance",
      isProfile: r === "profile",
      isReviews: r === "reviews",
      isJob: r === "job",
      navReviews: (r === "reviews" || r === "performance") ? "#fff" : "transparent",
      inkReviews: (r === "reviews" || r === "performance") ? "#201e1d" : "#fff",
      navActivity: on("activity"), inkActivity: ink("activity"),
      navMap: on("jobs-map"), inkMap: ink("jobs-map"),
      navMsg: on("messages"), inkMsg: ink("messages"),
      navPay: on("earnings"), inkPay: ink("earnings"),
      navPerf: on("performance"), inkPerf: ink("performance"),
      navProfile: on("profile"), inkProfile: ink("profile"),
      threads: THREADS.map((t, i) => ({
        name: t.name, preview: t.preview, when: t.when, initial: t.initial,
        bg: i === (this.state.thread || 0) ? "rgba(224,16,48,.06)" : "transparent",
        edge: i === (this.state.thread || 0) ? "4px solid #e01030" : "4px solid transparent",
        select: () => this.setState({ thread: i })
      })),
      chatInitial: THREADS[this.state.thread || 0].initial,
      chatName: THREADS[this.state.thread || 0].name,
      chatMessages: THREADS[this.state.thread || 0].messages.map((m) => ({
        text: m.me || m.them, fromMe: Boolean(m.me), fromThem: Boolean(m.them)
      })),
      pickOffer0: () => this.setOffer(0),
      pickOffer1: () => this.setOffer(1),
      steps: STEPS.map((st) => ({
        title: st.title,
        tick: st.done ? "✓" : "",
        mark: st.done ? "#ee352c" : "transparent",
        ring: st.done ? "0" : "2px solid rgba(32,30,29,.32)",
        state: st.done ? "RECORDED" : "OUTSTANDING"
      })),
      ...this.offerVals(),
      showChrome: !this.state.embedded,
      ...this.weekVals(),
      ...this.jobVals(),
      ...this.incidentVals(),
      accountNav: ACCOUNT.map((a) => ({ ...a, live: !a.note, inert: Boolean(a.note), ink: a.label === "Logout" ? "#a30c24" : "#201e1d" }))
    };
  }
}

return typeof Component!=='undefined'?Component:undefined;
},
"class Component extends DCLogic {\n  renderVals() {\n    return { w1920: 1920, win1080: 1164, w1512: 1512, win982: 1066, w1280: 1280, win800: 884 };\n  }\n}": function(DCLogic,StreamableLogic,React){

class Component extends DCLogic {
  renderVals() {
    return { w1920: 1920, win1080: 1164, w1512: 1512, win982: 1066, w1280: 1280, win800: 884 };
  }
}

return typeof Component!=='undefined'?Component:undefined;
},
"const ICONS = {\n  user: \"M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5\",\n  brief: \"M4 8h16v12H4zM9 8V5h6v3M4 13h16\",\n  card: \"M3 7h18v12H3zM3 11h18M6 15h4\",\n  id: \"M3 6h18v13H3zM7 11a2 2 0 1 0 4 0 2 2 0 0 0-4 0M6 15.5c.7-1.3 1.8-2 3-2s2.3.7 3 2M15 10h4M15 13h3\",\n  shield: \"M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6zM9 12l2 2 4-4\",\n  pin: \"M12 21c-4-4-7-7.5-7-11a7 7 0 0 1 14 0c0 3.5-3 7-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z\",\n  star: \"M12 3l2.7 5.7 6.3.9-4.5 4.4 1 6.3-5.5-3-5.5 3 1-6.3L3 9.6l6.3-.9z\",\n  umb: \"M12 3v1M3 13a9 9 0 0 1 18 0H3zM12 13v5a2.5 2.5 0 0 0 5 0\",\n  box: \"M5 8h14l-1.5 13h-11zM9 8a3 3 0 0 1 6 0\",\n  folder: \"M3 5h6l2 3h10v12H3zM3 8h8\",\n  award: \"M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM9 13l-1.5 7L12 17.5 16.5 20 15 13\",\n  pen: \"M4 20l1-4L16 5l3 3L8 19zM13 8l3 3\",\n  reg: \"M9 3h6v4H9zM15 5h4v16H5V5h4M9 12h6M9 16h4\"\n};\n\nconst STEPS = [\n  { route: \"personal-details\", icon: \"user\", title: \"Personal details\",\n    intro: \"Tell us who you are and how to reach you. This is the name clients will see once you go live.\",\n    note: \"Progress is saved for this browser tab as you type.\" },\n  { route: \"business-details\", icon: \"brief\", title: \"Business details\",\n    intro: \"Choose the services you want to offer and how you'll operate.\",\n    note: \"Progress is saved for this browser tab as you choose.\" },\n  { route: \"banking\", icon: \"card\", title: \"Banking & payments\",\n    intro: \"Where your earnings land. Stripe securely collects payout details, and Homlle never receives or displays your full bank details.\",\n    note: \"Payout setup completes in Stripe; Homlle records only that it is ready.\" },\n  { route: \"identity-verification\", icon: \"id\", title: \"Identity verification\",\n    intro: \"Government-issued photo ID. Homlle verifies documents through an approved secure process.\",\n    note: \"Selected documents and document numbers are encrypted and stored when you continue.\" },\n  { route: \"right-to-work\", icon: \"id\", title: \"Right to work\",\n    intro: \"We're legally required to confirm you can work in the UK before your first booking.\",\n    note: \"Nothing here is shared with clients. It is used only for the legal check.\" },\n  { route: \"background-checks\", icon: \"shield\", title: \"Background checks (DBS)\",\n    intro: \"Your criminal-record check. A DBS can make you eligible for more jobs, including schools and care settings.\",\n    note: \"A check reads as verified only once a verification authority confirms it.\" },\n  { route: \"work-areas\", icon: \"pin\", title: \"Work areas\",\n    intro: \"Explore the UK map and select outward postcodes for precise distance matching.\",\n    note: \"Saved areas use outward postcodes only; exact addresses are never shown here.\" },\n  { route: \"experience\", icon: \"star\", title: \"Skills and Experience\",\n    intro: \"What you're great at. Specialisms drive which jobs we offer you first.\",\n    note: \"Selected CV and certificate files are encrypted and stored when you continue.\" },\n  { route: \"insurance\", icon: \"umb\", title: \"Insurance\",\n    intro: \"Your insurance protects you, your clients and the work you provide through Homlle.\",\n    note: \"Documents are stored securely on submission. Verification stays pending until Homlle reviews them.\" },\n  { route: \"equipment\", icon: \"box\", title: \"Equipment & Travel\",\n    intro: \"Tell us what you can bring and how you usually travel to jobs.\",\n    note: \"Equipment and travel answers help match you to jobs you can actually take.\" },\n  { route: \"documents\", icon: \"folder\", title: \"Document centre\",\n    intro: \"Everything in one place. Secure document storage, OCR and expiry reminders are being connected.\",\n    note: \"Files are encrypted in Homlle's private database. Verification is separate from storage.\" },\n  { route: \"training\", icon: \"award\", title: \"Homlle Academy\",\n    intro: \"Free training catalogue for Cleaner development. Course delivery, progress tracking and certificates are being connected; nothing is started or recorded on this preview.\",\n    note: \"Only required training is active for now. No result or document is recorded here.\" },\n  { route: \"contracts\", icon: \"pen\", title: \"Contracts & agreements\",\n    intro: \"Review the policies and declarations in one place. E-signing, time-stamps and email copies are being connected.\",\n    note: \"Signing is not connected. Nothing entered here is stored, emailed or time-stamped.\" },\n  { route: \"review-submit\", icon: \"reg\", title: \"Review & submit\",\n    intro: \"Check each stage before sending your application to Homlle. Document numbers, full addresses and bank details are never displayed here.\",\n    note: \"Complete every required stage before submitting.\" }\n];\n\nconst HOME_BG = \"radial-gradient(ellipse at 84% 15%, rgba(255,255,255,.95) 0 10%, rgba(255,255,255,0) 38%), linear-gradient(106deg, #ff1747 0%, #ff0034 8%, #f10021 20%, #ef6f79 39%, #efc7c9 54%, #f5f5f5 72%, #ffffff 100%)\";\nconst RAIL_BG = \"linear-gradient(180deg, #ff1747 0%, #ff0034 55%, #d9002c 100%)\";\n\nclass Component extends DCLogic {\n  state = { route: (window.location.hash || \"#home\").slice(1) || \"home\" };\n\n  componentDidMount() {\n    this.onHash = () => this.setState({ route: (window.location.hash || \"#home\").slice(1) || \"home\" });\n    window.addEventListener(\"hashchange\", this.onHash);\n  }\n\n  componentWillUnmount() {\n    window.removeEventListener(\"hashchange\", this.onHash);\n  }\n\n  renderVals() {\n    const total = STEPS.length;\n    const done = Math.max(0, Math.min(total, this.props.stepsRecorded ?? 3));\n    const route = this.state.route;\n    const idx = STEPS.findIndex((s) => s.route === route);\n    const isStep = idx >= 0;\n    const step = isStep ? STEPS[idx] : STEPS[0];\n    const nextTitle = this.props.nextStep ?? \"Identity verification\";\n    const nextEntry = STEPS.find((s) => s.title.toLowerCase() === nextTitle.toLowerCase())\n      || STEPS[Math.min(done, total - 1)];\n\n    return {\n      total,\n      done,\n      left: total - done,\n      fill: (done / total * 100).toFixed(1) + \"%\",\n      tickFill: (done <= 0 ? 0 : done * ((380 - 13 * 4) / 14) + (done - 1) * 4).toFixed(2) + \"px\",\n      next: nextTitle,\n      nextRoute: \"#\" + (nextEntry ? nextEntry.route : \"personal-details\"),\n      showNeeds: this.props.showNeeds ?? true,\n\n      isHome: !isStep,\n      isStep,\n      shellBg: isStep ? \"#f3f2f2\" : HOME_BG,\n      railBg: isStep ? RAIL_BG : \"transparent\",\n      mainOverflow: isStep ? \"hidden auto\" : \"hidden\",\n\n      stepNumber: idx + 1,\n      stepTitle: step.title,\n      stepIntro: step.intro,\n      stepNote: step.note,\n      stepFill: ((idx + 1) / total * 100).toFixed(1) + \"%\",\n      railY: 8 + 46 * Math.max(0, idx),\n      activeIcon: ICONS[step.icon],\n      ticks: isStep ? Array.from({ length: done }, (_, i) => ({ top: 23 + 46 * i })) : [],\n      prevRoute: idx <= 0 ? \"#home\" : \"#\" + STEPS[idx - 1].route,\n      nextStepRoute: idx >= total - 1 ? \"#home\" : \"#\" + STEPS[idx + 1].route,\n\n      isPersonal: route === \"personal-details\",\n      isBusiness: route === \"business-details\",\n      isBanking: route === \"banking\",\n      isIdentity: route === \"identity-verification\",\n      isRtw: route === \"right-to-work\",\n      isDbs: route === \"background-checks\",\n      isAreas: route === \"work-areas\",\n      isExperience: route === \"experience\",\n      isInsurance: route === \"insurance\",\n      isEquipment: route === \"equipment\",\n      isDocuments: route === \"documents\",\n      isTraining: route === \"training\",\n      isContracts: route === \"contracts\",\n      isReview: route === \"review-submit\"\n    };\n  }\n}": function(DCLogic,StreamableLogic,React){

const ICONS = {
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5",
  brief: "M4 8h16v12H4zM9 8V5h6v3M4 13h16",
  card: "M3 7h18v12H3zM3 11h18M6 15h4",
  id: "M3 6h18v13H3zM7 11a2 2 0 1 0 4 0 2 2 0 0 0-4 0M6 15.5c.7-1.3 1.8-2 3-2s2.3.7 3 2M15 10h4M15 13h3",
  shield: "M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6zM9 12l2 2 4-4",
  pin: "M12 21c-4-4-7-7.5-7-11a7 7 0 0 1 14 0c0 3.5-3 7-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  star: "M12 3l2.7 5.7 6.3.9-4.5 4.4 1 6.3-5.5-3-5.5 3 1-6.3L3 9.6l6.3-.9z",
  umb: "M12 3v1M3 13a9 9 0 0 1 18 0H3zM12 13v5a2.5 2.5 0 0 0 5 0",
  box: "M5 8h14l-1.5 13h-11zM9 8a3 3 0 0 1 6 0",
  folder: "M3 5h6l2 3h10v12H3zM3 8h8",
  award: "M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM9 13l-1.5 7L12 17.5 16.5 20 15 13",
  pen: "M4 20l1-4L16 5l3 3L8 19zM13 8l3 3",
  reg: "M9 3h6v4H9zM15 5h4v16H5V5h4M9 12h6M9 16h4"
};

const STEPS = [
  { route: "personal-details", icon: "user", title: "Personal details",
    intro: "Tell us who you are and how to reach you. This is the name clients will see once you go live.",
    note: "Progress is saved for this browser tab as you type." },
  { route: "business-details", icon: "brief", title: "Business details",
    intro: "Choose the services you want to offer and how you'll operate.",
    note: "Progress is saved for this browser tab as you choose." },
  { route: "banking", icon: "card", title: "Banking & payments",
    intro: "Where your earnings land. Stripe securely collects payout details, and Homlle never receives or displays your full bank details.",
    note: "Payout setup completes in Stripe; Homlle records only that it is ready." },
  { route: "identity-verification", icon: "id", title: "Identity verification",
    intro: "Government-issued photo ID. Homlle verifies documents through an approved secure process.",
    note: "Selected documents and document numbers are encrypted and stored when you continue." },
  { route: "right-to-work", icon: "id", title: "Right to work",
    intro: "We're legally required to confirm you can work in the UK before your first booking.",
    note: "Nothing here is shared with clients. It is used only for the legal check." },
  { route: "background-checks", icon: "shield", title: "Background checks (DBS)",
    intro: "Your criminal-record check. A DBS can make you eligible for more jobs, including schools and care settings.",
    note: "A check reads as verified only once a verification authority confirms it." },
  { route: "work-areas", icon: "pin", title: "Work areas",
    intro: "Explore the UK map and select outward postcodes for precise distance matching.",
    note: "Saved areas use outward postcodes only; exact addresses are never shown here." },
  { route: "experience", icon: "star", title: "Skills and Experience",
    intro: "What you're great at. Specialisms drive which jobs we offer you first.",
    note: "Selected CV and certificate files are encrypted and stored when you continue." },
  { route: "insurance", icon: "umb", title: "Insurance",
    intro: "Your insurance protects you, your clients and the work you provide through Homlle.",
    note: "Documents are stored securely on submission. Verification stays pending until Homlle reviews them." },
  { route: "equipment", icon: "box", title: "Equipment & Travel",
    intro: "Tell us what you can bring and how you usually travel to jobs.",
    note: "Equipment and travel answers help match you to jobs you can actually take." },
  { route: "documents", icon: "folder", title: "Document centre",
    intro: "Everything in one place. Secure document storage, OCR and expiry reminders are being connected.",
    note: "Files are encrypted in Homlle's private database. Verification is separate from storage." },
  { route: "training", icon: "award", title: "Homlle Academy",
    intro: "Free training catalogue for Cleaner development. Course delivery, progress tracking and certificates are being connected; nothing is started or recorded on this preview.",
    note: "Only required training is active for now. No result or document is recorded here." },
  { route: "contracts", icon: "pen", title: "Contracts & agreements",
    intro: "Review the policies and declarations in one place. E-signing, time-stamps and email copies are being connected.",
    note: "Signing is not connected. Nothing entered here is stored, emailed or time-stamped." },
  { route: "review-submit", icon: "reg", title: "Review & submit",
    intro: "Check each stage before sending your application to Homlle. Document numbers, full addresses and bank details are never displayed here.",
    note: "Complete every required stage before submitting." }
];

const HOME_BG = "radial-gradient(ellipse at 84% 15%, rgba(255,255,255,.95) 0 10%, rgba(255,255,255,0) 38%), linear-gradient(106deg, #ff1747 0%, #ff0034 8%, #f10021 20%, #ef6f79 39%, #efc7c9 54%, #f5f5f5 72%, #ffffff 100%)";
const RAIL_BG = "linear-gradient(180deg, #ff1747 0%, #ff0034 55%, #d9002c 100%)";

class Component extends DCLogic {
  state = { route: (window.location.hash || "#home").slice(1) || "home" };

  componentDidMount() {
    this.onHash = () => this.setState({ route: (window.location.hash || "#home").slice(1) || "home" });
    window.addEventListener("hashchange", this.onHash);
  }

  componentWillUnmount() {
    window.removeEventListener("hashchange", this.onHash);
  }

  renderVals() {
    const total = STEPS.length;
    const done = Math.max(0, Math.min(total, this.props.stepsRecorded ?? 3));
    const route = this.state.route;
    const idx = STEPS.findIndex((s) => s.route === route);
    const isStep = idx >= 0;
    const step = isStep ? STEPS[idx] : STEPS[0];
    const nextTitle = this.props.nextStep ?? "Identity verification";
    const nextEntry = STEPS.find((s) => s.title.toLowerCase() === nextTitle.toLowerCase())
      || STEPS[Math.min(done, total - 1)];

    return {
      total,
      done,
      left: total - done,
      fill: (done / total * 100).toFixed(1) + "%",
      tickFill: (done <= 0 ? 0 : done * ((380 - 13 * 4) / 14) + (done - 1) * 4).toFixed(2) + "px",
      next: nextTitle,
      nextRoute: "#" + (nextEntry ? nextEntry.route : "personal-details"),
      showNeeds: this.props.showNeeds ?? true,

      isHome: !isStep,
      isStep,
      shellBg: isStep ? "#f3f2f2" : HOME_BG,
      railBg: isStep ? RAIL_BG : "transparent",
      mainOverflow: isStep ? "hidden auto" : "hidden",

      stepNumber: idx + 1,
      stepTitle: step.title,
      stepIntro: step.intro,
      stepNote: step.note,
      stepFill: ((idx + 1) / total * 100).toFixed(1) + "%",
      railY: 8 + 46 * Math.max(0, idx),
      activeIcon: ICONS[step.icon],
      ticks: isStep ? Array.from({ length: done }, (_, i) => ({ top: 23 + 46 * i })) : [],
      prevRoute: idx <= 0 ? "#home" : "#" + STEPS[idx - 1].route,
      nextStepRoute: idx >= total - 1 ? "#home" : "#" + STEPS[idx + 1].route,

      isPersonal: route === "personal-details",
      isBusiness: route === "business-details",
      isBanking: route === "banking",
      isIdentity: route === "identity-verification",
      isRtw: route === "right-to-work",
      isDbs: route === "background-checks",
      isAreas: route === "work-areas",
      isExperience: route === "experience",
      isInsurance: route === "insurance",
      isEquipment: route === "equipment",
      isDocuments: route === "documents",
      isTraining: route === "training",
      isContracts: route === "contracts",
      isReview: route === "review-submit"
    };
  }
}

return typeof Component!=='undefined'?Component:undefined;
}};
window.__homlleCss={"\n    .sc-placeholder{background:color-mix(in srgb,currentColor 8%,transparent);\n      border:1px solid color-mix(in srgb,currentColor 50%,transparent);\n      border-radius:2px;box-sizing:border-box;overflow:hidden}\n    @keyframes sc-shine{0%{background-position:100% 50%}100%{background-position:0% 50%}}\n    html.sc-dc-streaming .sc-placeholder,\n    html.sc-dc-streaming .sc-interp.sc-missing{position:relative;\n      background:color-mix(in srgb,currentColor 5%,transparent);\n      border-color:transparent}\n    html.sc-dc-streaming .sc-placeholder::before,\n    html.sc-dc-streaming .sc-interp.sc-missing::before{content:'';\n      position:absolute;inset:0;pointer-events:none;\n      background:linear-gradient(90deg,rgba(217,119,87,0) 25%,rgba(247,225,211,.95) 37%,rgba(217,119,87,0) 63%);\n      background-size:400% 100%;animation:sc-shine 1.4s ease infinite}\n    html.sc-dc-streaming .sc-placeholder:nth-child(n+9 of .sc-placeholder)::before,\n    html.sc-dc-streaming .sc-interp.sc-missing:nth-child(n+9 of .sc-interp.sc-missing)::before{animation:none;\n      background:color-mix(in srgb,currentColor 8%,transparent)}\n    .sc-placeholder-error{padding:4px 8px;font:11px/1.4 ui-monospace,monospace;\n      color:color-mix(in srgb,currentColor 70%,transparent);word-break:break-word}\n    .sc-interp.sc-missing{display:inline-block;width:2em;height:1em;overflow:hidden;\n      vertical-align:text-bottom;background:rgba(255,255,255,.3);border:1px solid rgba(0,0,0,.5);\n      border-radius:2px;box-sizing:border-box;color:transparent;\n      user-select:none}\n    .sc-interp.sc-unresolved{font-family:ui-monospace,monospace;font-size:.85em;\n      color:color-mix(in srgb,currentColor 50%,transparent);\n      background:color-mix(in srgb,currentColor 10%,transparent);border-radius:3px;\n      padding:0 3px}\n    .sc-host.sc-has-error{position:relative}\n    .sc-logic-error{position:absolute;top:8px;left:8px;z-index:2147483647;max-width:60ch;\n      padding:6px 10px;background:#b00020;color:#fff;font:12px/1.4 ui-monospace,monospace;\n      border-radius:4px;white-space:pre-wrap;pointer-events:none}\n    /* Mirrors PRINT_BASELINE_CSS in apps/web deck-stage-export.ts — keep both\n       in sync until dc-runtime regains a build step. */\n    @media print {\n      @page { margin: 0.5cm; }\n      figure, table { break-inside: avoid; }\n      #dc-root, #dc-root > .sc-host { height: auto; }\n      *, *::before, *::after {\n        print-color-adjust: exact; -webkit-print-color-adjust: exact;\n        backdrop-filter: none !important; -webkit-backdrop-filter: none !important;\n        animation-delay: -99s !important; animation-duration: .001s !important;\n        animation-iteration-count: 1 !important; animation-fill-mode: both !important;\n        animation-play-state: running !important; transition-duration: 0s !important;\n      }\n    }\n  ":"css/7b4b3c5197d9514e.css","x-dc{display:none!important}":"css/e7a8565d0b38f4e6.css","html,body{height:100%;margin:0}#dc-root,#dc-root>.sc-host{height:100%}":"css/bb4318375eeb4000.css","\n    body { margin: 0; background: #eceaea; }\n    a { color: #201e1d; }\n    a:hover { color: #e01030; }\n    .seg-opt { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; }\n    [data-phone-scroll] { scrollbar-width: none; -ms-overflow-style: none; }\n    [data-phone-scroll]::-webkit-scrollbar { width: 0; height: 0; display: none; }\n  ":"css/54fc425cfc581f47.css","\n    body { margin: 0; min-height: 100vh; padding: 20px; box-sizing: border-box; background: #d7d7d7; }\n    a { color: #201e1d; }\n    a:hover { color: #e01030; }\n    /* the tappable box is .seg-opt (its radio is visually hidden), so it carries the 44px minimum */\n    .seg-opt { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; }\n    [data-mobilebar] { display: none; }\n    @media (max-width: 700px) {\n      body { padding: 0; }\n      [data-shell] { flex-direction: column; height: 100dvh; max-height: 100dvh; }\n      [data-rail] { display: none !important; }\n      [data-mobilebar] { display: flex; }\n      [data-pagetitle] { font-size: 27px !important; }\n      [data-chiplabel] { display: none; }\n      [data-pagehead] { padding: 18px 18px 20px !important; }\n      [data-pagebody] { padding: 18px 18px 24px !important; }\n      /* seven 44px day links need ~308px; the card only offered 294px, so the\n         width comes back off its side padding and the strip's gaps */\n      [data-weekcard] { padding-left: 8px !important; padding-right: 8px !important; }\n      [data-weekstrip] { gap: 0 !important; }\n      [data-weekstrip] > a > span:first-child { width: calc(100% - 5px) !important; }\n      [data-scroll] { flex: 1; min-height: 0; height: auto; max-height: none; overflow-y: auto; }\n    }\n    [data-scroll] { scrollbar-width: none; -ms-overflow-style: none; }\n    [data-scroll]::-webkit-scrollbar { width: 0; height: 0; display: none; }\n  ":"css/b6ed4eec7ce5ec5b.css","\n    body { margin: 0; background: #f3f2f2; }\n    a { color: #201e1d; }\n    a:hover { color: #ec3013; }\n  ":"css/213a094f9248dba6.css","\n    body { margin: 0; min-height: 100vh; box-sizing: border-box; padding: 44px; background: #d7d7d7; display: grid; place-items: center; }\n    a { color: #201e1d; }\n    a:hover { color: #e01030; }\n    fieldset { min-width: 0; }\n    legend { display: block; width: 100%; padding: 0; }\n    .input { border-radius: 12px; }\n    .field > label { font-weight: 600; letter-spacing: .01em; }\n  ":"css/b91be25f583c8f3c.css","\n    body { margin: 0; background: #eceaea; }\n    a { color: #201e1d; }\n    a:hover { color: #e01030; }\n    /* phones don't paint desktop scrollbars; inline styles can't express this */\n    [data-phone-scroll] { scrollbar-width: none; -ms-overflow-style: none; }\n    [data-phone-scroll]::-webkit-scrollbar { width: 0; height: 0; display: none; }\n    /* the tappable box is .seg-opt (its radio is visually hidden), so it carries the 44px minimum */\n    .seg-opt { display: inline-flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; }\n  ":"css/6c5d3fe7f2bdcb37.css","\n    body { margin: 0; background: #e4e3e2; }\n    a { color: #201e1d; }\n    a:hover { color: #e01030; }\n  ":"css/f4617eb21a8c4fb5.css","\n    body { margin: 0; background: #f3f2f2; }\n    a { color: #201e1d; }\n    a:hover { color: #e01030; }\n  ":"css/fa6e7646ad7114cd.css"};
