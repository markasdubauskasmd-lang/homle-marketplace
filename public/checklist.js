import { briefRoomOptions } from "./brief-readiness.js";

const spokenRoomAliases = new Map([
  ["lounge", "Living room"],
  ["wc", "Toilet"],
  ["bathroom one", "Bathroom 1"], ["bathroom two", "Bathroom 2"], ["bathroom three", "Bathroom 3"],
  ["bedroom one", "Bedroom 1"], ["bedroom two", "Bedroom 2"], ["bedroom three", "Bedroom 3"],
  ["bedroom four", "Bedroom 4"], ["bedroom five", "Bedroom 5"]
]);
const canonicalRooms = new Map(briefRoomOptions.map((room) => [room.toLowerCase(), room]));
const roomNames = [...new Set([...canonicalRooms.keys(), ...spokenRoomAliases.keys()])].sort((a, b) => b.length - a.length);
const roomPattern = roomNames.map((room) => room.replace(/\s+/g, "\\s+")).join("|");
const spokenRoomBoundaryLeadPattern = [
  "(?:in|for)\\s+(?:the\\s+)?",
  "(?:this|that)\\s+is\\s+(?:the\\s+)?",
  "(?:we(?:'re|\\s+are)|i(?:'m|\\s+am))\\s+(?:now\\s+)?(?:in|entering|moving\\s+into|walking\\s+into)\\s+(?:the\\s+)?",
  "now\\s+(?:in\\s+)?(?:the\\s+)?",
  "next\\s+(?:(?:room\\s+)?is|we\\s+(?:have|enter))\\s+(?:the\\s+)?"
].join("|");
const spokenRoomLeadPattern = `${spokenRoomBoundaryLeadPattern}|(?:moving|walking|going)\\s+(?:into|to)\\s+(?:the\\s+)?`;
const actionPattern = [
  "clean", "wipe", "mop", "vacuum", "hoover", "sweep", "dust", "scrub",
  "disinfect", "sanitise", "sanitize", "polish", "degrease", "descale", "remove",
  "empty", "wash", "dry", "tidy", "organise", "organize", "change", "replace",
  "make", "strip", "rinse", "clear", "take", "put", "leave", "avoid", "focus",
  "check", "do not", "don't", "dont", "skip", "exclude", "no need to",
  "not necessary to", "not required to"
].join("|");
const passiveActions = new Map([
  ["cleaned", "Clean"], ["cleaning", "Clean"], ["wiped", "Wipe"], ["wiping", "Wipe"],
  ["mopped", "Mop"], ["mopping", "Mop"], ["vacuumed", "Vacuum"], ["vacuuming", "Vacuum"],
  ["hoovered", "Vacuum"], ["hoovering", "Vacuum"], ["swept", "Sweep"], ["sweeping", "Sweep"],
  ["dusted", "Dust"], ["dusting", "Dust"], ["scrubbed", "Scrub"], ["scrubbing", "Scrub"],
  ["disinfected", "Disinfect"], ["disinfecting", "Disinfect"],
  ["sanitised", "Sanitise"], ["sanitising", "Sanitise"], ["sanitized", "Sanitise"], ["sanitizing", "Sanitise"],
  ["polished", "Polish"], ["polishing", "Polish"], ["degreased", "Degrease"], ["degreasing", "Degrease"],
  ["descaled", "Descale"], ["descaling", "Descale"], ["removed", "Remove"], ["removing", "Remove"],
  ["emptied", "Empty"], ["emptying", "Empty"], ["washed", "Wash"], ["washing", "Wash"],
  ["dried", "Dry"], ["drying", "Dry"], ["tidied", "Tidy"], ["tidying", "Tidy"],
  ["organised", "Organise"], ["organising", "Organise"], ["organized", "Organise"], ["organizing", "Organise"],
  ["changed", "Change"], ["changing", "Change"], ["replaced", "Replace"], ["replacing", "Replace"],
  ["rinsed", "Rinse"], ["rinsing", "Rinse"], ["cleared", "Clear"], ["clearing", "Clear"]
]);

function canonicalRoom(value) {
  const room = value.trim().replace(/\s+/g, " ").toLowerCase();
  return spokenRoomAliases.get(room) || canonicalRooms.get(room) || "";
}

function taskObject(value) {
  return value.trim().replace(/^(?:The|A|An)\b/, (article) => article.toLowerCase());
}

// Speech drops articles ("kitchen floor mopping"), which leaves bullets reading
// "Mop floor". Only these everyday surfaces get an article back, so wording the
// customer actually chose is never rewritten.
const bareSurfaceNouns = new Set([
  "floor", "floors", "carpet", "carpets", "rug", "rugs", "worktop", "worktops", "hob", "oven",
  "sink", "bath", "shower", "toilet", "mirror", "mirrors", "shelves", "windows", "window",
  "skirting", "fridge", "freezer", "microwave", "bin", "bins", "table", "tables", "sofa", "stairs"
]);

function articledTaskObject(value) {
  const object = taskObject(value);
  if (/^(?:the|a|an|all|every|each|both|my|your|their)\b/i.test(object)) return object;
  return bareSurfaceNouns.has(object.toLowerCase()) ? `the ${object}` : object;
}

function cleaningTarget(value) {
  const target = taskObject(value).replace(/^(?:the\s+)+/i, "").trim();
  return target ? `the ${target}` : "";
}

function describedConditionInstruction(value) {
  const description = value
    .replace(/^(?:there(?:'s|\s+is|\s+are)|you\s+can\s+see)\s+/i, "")
    .replace(/^(?:lots?\s+of|some|visible)\s+/i, "")
    .trim();
  const condition = description.match(/^(soap\s+scum|water\s+marks?|fingerprints?|smudges?|streaks?|limescale|cobwebs?|crumbs?|grease|grime|dust|marks?|spills?|stains?)\s+(on|around|in|inside|under|along)\s+(.+)$/i);
  if (!condition) return "";
  const kind = condition[1].toLowerCase();
  const position = condition[2].toLowerCase();
  const target = cleaningTarget(condition[3]);
  if (!target) return "";
  if (kind === "dust") return `Dust ${target}`;
  if (kind === "grease" || kind === "grime") return position === "on" ? `Degrease ${target}` : `Degrease ${position} ${target}`;
  if (kind === "limescale" || kind === "soap scum") return `Remove ${kind} from ${target}`;
  if (kind.startsWith("crumb") || kind.startsWith("cobweb") || kind.startsWith("spill") || kind.startsWith("stain") || kind === "mark" || kind === "marks" || kind.startsWith("water mark")) return `Remove ${kind} from ${target}`;
  return `Wipe ${kind} from ${target}`;
}

// Polishing suits glass and metal. Prescribing it for a painted wall would ask
// the Cleaner to do something that could damage the surface, so the inferred
// method depends on what is being described.
const polishableTargets = /\b(?:mirror|glass|window|screen|tap|taps|chrome|splashback|worktop|worktops|surface|surfaces|table|cabinet|door)\b/i;

function describedStateAction(state, target = "") {
  const described = state.toLowerCase();
  if (described === "greasy") return "Degrease";
  if (described === "dusty") return "Dust";
  if (described === "smudged" || described === "smeared") return polishableTargets.test(target) ? "Polish" : "Wipe";
  if (described === "mouldy") return "Remove mould from";
  if (described === "stained" || described === "marked" || described === "scuffed") return "Remove marks from";
  if (described === "cluttered" || described === "messy") return "Tidy";
  return "Clean";
}

function soiledAction(soiling) {
  const kind = soiling.toLowerCase().replace(/\s+/g, " ");
  if (kind.startsWith("burnt")) return "Remove burnt-on residue from";
  if (kind === "grease" || kind === "grime") return "Degrease";
  if (kind === "dust") return "Dust";
  if (kind === "mould") return "Remove mould from";
  return `Remove ${kind} from`;
}

function activeCleaningInstruction(rawValue) {
  // Speech restates its subject through pronouns ("it's the shower screen it's
  // got limescale on it"). Collapsing that leaves one clean subject to act on.
  const value = String(rawValue)
    .replace(/^(?:it(?:'s|\s+is)\s+)+/i, "")
    .replace(/\s+it(?:'s|\s+is|\s+has)\s+(?=got\b|has\b)/i, " ")
    .replace(/\s+it(?:'s)\s+got\b/i, " has got")
    .trim();
  if (/^(?:that(?:'s|\s+is)\s+(?:all|everything)(?:\s+in\s+here|\s+for\s+this\s+room)?|nothing\s+else(?:\s+in\s+here)?|moving\s+on|done(?:\s+in\s+here|\s+with\s+this\s+room)?)$/i.test(value)) return "";
  const nounPhrase = nounPhraseInstruction(value);
  if (nounPhrase) return nounPhrase;
  const leaveAlone = value.match(/^(.+?)\s+(?:should|must|needs?\s+to)\s+be\s+(?:left|kept)\s+(?:alone|as\s+is|in\s+place)$/i);
  if (leaveAlone) return `Leave ${taskObject(leaveAlone[1])} alone`;
  if (/^(?:the\s+)?sink\s+(?:is|looks?)\s+(?:full\s+of|filled\s+with)\s+(?:dirty\s+)?dishes$/i.test(value)) return "Wash the dishes in the sink";
  const excludedPassive = value.match(/^(.+?)\s+(?:does(?:\s+not|n't)|do(?:\s+not|n't))\s+(?:need|require)\s+(?:(?:to\s+be|any)\s+)?([a-z]+)$/i);
  if (excludedPassive) {
    const action = passiveActions.get(excludedPassive[2].toLowerCase());
    if (action) return `Do not ${action.toLowerCase()} ${taskObject(excludedPassive[1])}`;
  }
  // A spoken instruction usually carries a particle or qualifier the written
  // form omits: "needs wiping down", "wants hoovering properly".
  const passive = value.match(/^(.+?)\s+(?:needs?|requires?|wants?)\s+(?:(?:to\s+be|some|a\s+(?:good|proper|quick|decent))\s+)?([a-z]+)(?:\s+(?:down|up|out|off|over|through|properly|thoroughly|again|first))?$/i);
  if (passive) {
    const action = passiveActions.get(passive[2].toLowerCase());
    if (action) return `${action} ${articledTaskObject(passive[1])}`;
    if (/^attention$/i.test(passive[2])) return `Clean ${articledTaskObject(passive[1])}`;
  }
  // A trailing gerund names the work after its target ("the floor mopping",
  // "bedding changing"), which is how people speak when listing rooms quickly.
  const trailingGerund = value.match(/^(.+?)\s+([a-z]+ing)(?:\s+(?:down|up|out|off|over|through|properly|thoroughly))?$/i);
  if (trailingGerund) {
    const action = passiveActions.get(trailingGerund[2].toLowerCase());
    if (action) return `${action} ${articledTaskObject(trailingGerund[1])}`;
  }
  // People describe what they can see rather than name a cleaning verb. The
  // Cleaner needs the action, so a described state becomes the work it implies.
  const described = value.match(/^(.+?)\s+(?:is|are|looks?|look|'s)\s+(?:(?:very|really|quite|all|so|a\s+bit|pretty|absolutely)\s+)?(greasy|dusty|smudged|smeared|grubby|grimy|sticky|stained|marked|scuffed|mouldy|filthy|dirty|messy|manky|cluttered)$/i);
  if (described) return `${describedStateAction(described[2], described[1])} ${taskObject(described[1])}`;
  // "the hob has burnt on stuff" / "the oven has grease all over it"
  // Anchored deliberately: an earlier version consumed the rest of the clause,
  // so "the oven has grease but don't clean it" produced "Degrease the oven" —
  // the exact opposite of the instruction. Only a harmless tail may follow.
  const soiled = value.match(/^(.+?)\s+(?:has|have|'s|has\s+got|have\s+got|got)\s+(?:(?:lots?|loads?|a\s+lot)\s+of\s+|some\s+|a\s+bit\s+of\s+)?(burnt[\s-]?on(?:\s+\w+)?|grease|grime|limescale|soap\s+scum|mould|dust|crumbs?|stains?|marks?)\b(?:\s+(?:on|all\s+over|around|round|in|inside)?\s*(?:it|them|there|everywhere))?$/i);
  if (soiled) return `${soiledAction(soiled[2])} ${taskObject(soiled[1])}`;
  // "the toilet needs doing" — a real instruction with no named verb.
  const needsDoing = value.match(/^(.+?)\s+needs?\s+(?:a\s+)?(?:doing|done|sorting|sorted|going\s+over|seeing\s+to)(?:\s+\w+)?$/i);
  if (needsDoing) return `Clean ${taskObject(needsDoing[1])}`;
  return describedConditionInstruction(value) || value;
}

// "Toilet" is both a room and a fixture. Once the walkthrough is already inside
// a room, "the toilet needs doing" describes the fixture in that room — reading
// it as a room change would move every following task out of the bathroom.
const ambiguousFixtureRooms = new Set(["Toilet"]);

function fixtureRatherThanRoom(spokenRoom, currentRoom, matchedPrefix, remainder) {
  const room = canonicalRoom(spokenRoom);
  if (!room || !ambiguousFixtureRooms.has(room)) return false;
  if (!currentRoom || currentRoom === room) return false;
  // "In the WC" and "this is the toilet" name a room outright. Only a bare
  // mention is open to being the fixture inside the room already being described.
  if (/^(?:in|for|this\s+is|that\s+is|we|i|now|next|moving|walking|going)\b/i.test(matchedPrefix.trim())) return false;
  // The room prefix absorbs a trailing "needs"/"should be", so the giveaway
  // that this is a fixture being described lives in the matched prefix itself.
  if (/\b(?:needs?|requires?|should\s+be)\b/i.test(matchedPrefix)) return true;
  // A room announcement is followed by its own instructions; a fixture is
  // followed by its condition or by nothing at all.
  return remainder.trim() === "" || /^(?:needs?|requires?|is|are|looks?|has|have|got|and\b)/i.test(remainder.trim());
}

// "give it a quick mop", "a proper clean" — the action is carried by a noun, so
// the bullet would otherwise start with an article and name no work at all.
const nounPhraseActions = new Map([
  ["mop", "Mop the floor"], ["hoover", "Vacuum the floor"], ["vacuum", "Vacuum the floor"],
  ["clean", "Clean thoroughly"], ["tidy", "Tidy up"], ["dust", "Dust throughout"],
  ["wipe", "Wipe down"], ["scrub", "Scrub thoroughly"], ["polish", "Polish throughout"],
  ["going over", "Clean thoroughly"], ["once over", "Clean thoroughly"], ["sort out", "Tidy up"]
]);

function nounPhraseInstruction(value) {
  const phrase = value.match(/^(?:give\s+(?:it|the\s+\w+)\s+)?an?\s+((?:quick|good|proper|deep|thorough|light|decent|bit\s+of\s+a)\s+)?([a-z]+(?:\s+over)?)$/i);
  if (!phrase) return "";
  const action = nounPhraseActions.get(phrase[2].toLowerCase());
  if (!action) return "";
  // "a quick clean" and "a deep clean" are different jobs at different prices,
  // so the qualifier the customer chose is never flattened away.
  const qualifier = (phrase[1] || "").trim().toLowerCase();
  if (/^(?:quick|light)$/.test(qualifier)) return action.replace(/^Clean thoroughly$/, "Quick clean").replace(/^(Tidy up|Dust throughout|Wipe down)$/, "$1 quickly");
  if (/^(?:deep|thorough|proper)$/.test(qualifier)) return action.replace(/^Clean thoroughly$/, "Deep clean");
  return action;
}

// Filler is removed only where it wraps an instruction, never mid-phrase, so a
// genuine word is not cut out of what the customer asked for.
function strippedFillers(value) {
  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    // "right" is only filler when it is not pointing at a place: "right corner"
    // and "right hand side" are the customer telling the Cleaner where to work.
    .replace(/^(?:(?:um+|uh+|erm+|er+|okay|ok|right(?!\s+(?:corner|side|hand|angle|way|through|across|down|up|by|at|of|next|through))|so|well|yeah|yep|now|then|and|also|just|basically|actually|literally|honestly|please|but|however|although|though)\b[,\s]*)+/i, "")
    .replace(/[,\s]*(?:\b(?:as\s+well|too|innit|you\s+know|or\s+something|or\s+whatever|i\s+think|i\s+guess|if\s+(?:that(?:'s|\s+is)\s+)?(?:ok|okay|alright)|if\s+you\s+can|please|um+|uh+|erm+|er+|yeah|yep|like|obviously|basically)\b[,\s]*)+$/i, "")
    // Segmentation cuts before a connective, so clauses routinely end on a
    // dangling "and". Left in, every other bullet trails off mid-sentence.
    .replace(/[,\s]*\b(?:and|but|or|then|also|plus)\s*$/i, "")
    .trim();
}

// A fragment left behind by segmentation ("start", "then", "in here") is not an
// instruction. Publishing it as a room task would put a meaningless line in
// front of the Cleaner.
// A location word left stranded by a clause break belongs to the phrase that
// follows it. "inside", "behind" and "under" are exactly the words that decide
// whether an oven interior or only its door was requested.
function danglingPrefix(value) {
  return /^(?:the\s+)?(?:inside|outside|behind|underneath|under|around|round|beneath|beside|between|above|below|back|front|top|bottom|edges?|corners?)(?:\s+of)?$/i.test(String(value).trim());
}

// Some instructions really are one word — "vacuum", "hoover", "dust". Dropping
// them as fragments would silently lose work the customer asked for.
const singleWordActions = new Set([
  "vacuum", "hoover", "mop", "dust", "tidy", "sweep", "clean", "declutter",
  "polish", "scrub", "disinfect", "sanitise", "sanitize", "everything", "throughout",
  "wipe", "wash", "empty", "clear", "rinse", "change", "replace", "degrease",
  "descale", "dry", "organise", "organize", "strip", "hoovering", "vacuuming"
]);

function navigationOnly(value) {
  const fragment = String(value).toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!fragment) return true;
  if (/^(?:[a-z]+:\s*)?(?:start|starting|begin|beginning|first|firstly|second|secondly|lastly|finally|then|next|now|also|and|so|okay|ok|well|here|in here|over here|this one|that one|move on|moving on|carry on|go on|continue|done|all done|thats it|that is it|thats all|that is all|nothing else|same again|same as before|etc)$/.test(fragment)) return true;
  const words = fragment.replace(/^[a-z]+:\s*/, "").split(" ").filter(Boolean);
  if (words.length === 1) return !singleWordActions.has(words[0]);
  return words.length < 1;
}

// The thing a bullet acts on, used only to give a following exclusion something
// concrete to refer to.
function spokenTarget(task) {
  const body = task.replace(/^[^:]+:\s*/, "");
  // "Remove limescale from the sink" targets the sink, not the limescale, so
  // the phrase after a trailing preposition wins when one is present.
  const viaPreposition = body.match(/\b(?:from|inside|behind|under|around)\s+(the\s+[a-z][a-z\s]*)$/i);
  const direct = body.match(/^[A-Za-z-]+(?:\s+(?:on|off|out|down|up))?\s+(the\s+[a-z][a-z\s]*|a\s+[a-z][a-z\s]*)$/i);
  const target = (viaPreposition?.[1] || direct?.[1] || "").trim();
  // An adjunct such as "with degreaser" describes the method, not the thing.
  // Keeping it would narrow a total exclusion into a method-specific one.
  return target.replace(/\s+(?:with|using|by)\s+.*$/i, "").trim();
}

function checklistTaskKey(value) {
  return value.toLowerCase()
    .replace(/\bthe\b/g, "")
    .replace(/\bhoover(?:ed|ing)?\b/g, "vacuum")
    .replace(/\bsanitiz(?:e|ed|ing)\b/g, "sanitise")
    .replace(/\borganiz(?:e|ed|ing)\b/g, "organise")
    .replace(/[^a-z0-9:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseChecklistTask(value) {
  if (typeof value !== "string") return "";
  const task = activeCleaningInstruction(value
    .slice(0, 300)
    .trim()
    .replace(/^[-*\u2022\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:(?:um+|uh+|erm|okay|right(?!\s+(?:corner|side|hand|angle|way|through|across|down|up|by|at|of))|so)\b[, ]*)+/i, "")
    .replace(/^(?:please|could you|can you|the cleaner should|i(?:'d| would) like (?:you|the cleaner) to|i want (?:you|the cleaner) to|make sure (?:you|the cleaner)?|we need (?:you|the cleaner)?\s*to)\s+/i, "")
    .replace(/^(?:please|could you|can you)\s+/i, "")
    .replace(/^(?:don't|dont)\s+/i, "Do not ")
    .replace(/^(?:no need to|not necessary to|not required to)\s+/i, "Do not ")
    .replace(/^(?:skip|exclude)\s+(?:cleaning\s+)?(?:the\s+)?/i, "Do not clean the ")
    .trim());
  if (task.length < 3) return "";
  return `${task.charAt(0).toUpperCase()}${task.slice(1)}`.replace(/[,;.!?]+$/, "");
}

// Speech arrives with almost no punctuation, so sentence splitting alone leaves
// several instructions fused into one unreadable bullet. These describe where a
// new instruction begins in a continuous spoken stream.
//
// A room word only starts a new room when it is not modifying a surface:
// "then the bedroom" switches room, "the kitchen floor" does not.
const roomModifiedNouns = "floor|floors|sink|sinks|worktops?|surfaces?|counters?|windows?|doors?|cupboards?|units?|tiles?|walls?|ceilings?|bins?|tables?|shelves|shelf|carpet|rug|mirror|blinds?|curtains?|radiators?|skirting";
const bareRoomBoundaryLead = "(?:and|then|also|next|now|after\\s+that|finally|,)\\s+(?:in\\s+)?(?:the\\s+)?";
// "then the bedroom" announces a room even when a surface follows it, while a
// bare "and the kitchen floor" is describing a surface. Only an explicit move
// word is trusted to override the surface guard.
// Deliberately excludes "moving into" and similar phrases: those already have
// their own room-boundary rule that keeps the speaker's subject attached, and
// duplicating them here strands the subject ("We're") as its own task.
const explicitMoveLead = "(?:and\\s+)?(?:then|next|after\\s+that|finally)\\s+(?:in\\s+)?(?:the\\s+)?";
const roomSwitchMark = "~~ROOMSWITCH~~";
// Continuous speech runs imperatives together with no connective at all
// ("wipe the worktops mop the floor clean the oven"). Requiring a determiner
// after the verb keeps this from splitting ordinary phrases mid-instruction.
const spokenImperativeLead = "(?:clean|wipe|mop|vacuum|hoover|sweep|dust|scrub|disinfect|sanitise|sanitize|polish|degrease|descale|remove|empty|wash|tidy|change|replace|strip|rinse|clear|hoover)\\s+(?:the|all|every|each|any|inside|outside|behind|under|underneath|around)\\b";
// A contrast word almost always introduces an exclusion. Without a break here
// the exclusion is absorbed into the preceding instruction and inverted.
const contrastLead = "(?:but|however|although|though|except|apart\\s+from|other\\s+than)\\b";
const negationBond = "~~NEGATION~~";
const negatedInstruction = /\b(do\s+not|don't|dont|doesn't|no\s+need\s+to|not\s+necessary\s+to|not\s+required\s+to|never|avoid|skip|leave)\s+(clean|wipe|mop|vacuum|hoover|sweep|dust|scrub|disinfect|sanitise|sanitize|polish|degrease|descale|remove|empty|wash|tidy|change|replace|strip|rinse|clear|touch|move)\b/gi;
const passiveClauseStart = "(?:the\\s+)(?:[a-z]+\\s+){0,2}?(?:needs?|requires?|is|are|looks?|has|have)\\b";
// Fillers a person says while thinking. They carry no instruction and make a
// bullet unreadable, but they are only removed at a clause boundary so ordinary
// words inside an instruction are never damaged.
const spokenFillers = /\b(?:um+|uh+|erm+|er+|basically|literally|obviously|actually|honestly|i\s+guess|you\s+know|sort\s+of|kind\s+of|a\s+bit\s+of|yeah|yep|okay|ok|right|well|so|just|please|like)\b/gi;

// A negation stranded at the end of a segment has been cut off from the verb it
// negates. Publishing the two halves separately produces a bare "Don't" beside
// an affirmative "Clean the oven" — the instruction the customer explicitly
// refused. Any such segment is rejoined with the one that follows it.
const danglingNegation = /(?:^|\s)(?:do\s+not|don'?t|dont|does\s+not|doesn'?t|never|avoid|skip|exclude|no\s+need\s+to|not\s+necessary\s+to|not\s+required\s+to)(?:\s+(?:ever|also|actually|really|even|then|just))*[,\s]*$/i;

function rejoinedNegations(sections) {
  const joined = [];
  for (const section of sections) {
    const previous = joined[joined.length - 1];
    if (previous !== undefined && danglingNegation.test(previous)) joined[joined.length - 1] = `${previous.trim()} ${section.trim()}`;
    else joined.push(section);
  }
  return joined;
}

export function checklistFromTranscript(rawValue) {
  if (typeof rawValue !== "string") return [];
  // Phone keyboards and speech engines emit typographic apostrophes; without
  // normalising them "don’t clean" is not recognised as a negation at all.
  // Literal sentinel text is removed so dictated or pasted input can never be
  // mistaken for this function's own control markers.
  const value = rawValue
    .replace(/[‘’ʼ]/g, "'")
    .split(roomSwitchMark).join(" ")
    .split(negationBond).join(" ");
  const roomBoundary = new RegExp(`\\s+(?=(?:${spokenRoomBoundaryLeadPattern})(?:${roomPattern})\\b)`, "gi");
  // A bare room mention after a connective is the commonest spoken room switch
  // ("hoover the lounge and the hallway needs a mop"). Missing it previously
  // attributed one room's work to another — the worst possible error here.
  const bareRoomBoundary = new RegExp(`\\s+(?=${bareRoomBoundaryLead}(?:${roomPattern})\\b(?!\\s+(?:${roomModifiedNouns})))`, "gi");
  const explicitRoomSwitch = new RegExp(`\\s+(?=${explicitMoveLead}(?:${roomPattern})\\b)`, "gi");
  const spokenPassiveBoundary = new RegExp(`\\s+(?=${passiveClauseStart})`, "gi");
  const imperativeBoundary = new RegExp(`\\s+(?=${spokenImperativeLead})`, "gi");
  const contrastBoundary = new RegExp(`\\s+(?=${contrastLead})`, "gi");
  const roomPrefix = new RegExp(`^(?:(?:${spokenRoomLeadPattern})|(?:the\\s+)?)(${roomPattern})\\b(?:\\s+now)?\\s*(?::|,|\\-|needs?\\s+(?:to\\s+be\\s+)?|should\\s+be\\s+)?\\s*`, "i");
  const actionBoundary = new RegExp(`(?:,\\s*|\\s+(?:and|then)\\s+)(?=(?:please\\s+)?(?:${actionPattern})\\b)`, "gi");
  const passiveBoundary = /(?:,\s*(?:and\s+)?|\s+and\s+)(?=(?:the\s+)?[^,]{1,80}\s+(?:needs?|requires?|is|are|looks?|look)\b)/gi;
  const conditionBoundary = /(?:,\s*(?:and\s+)?|\s+and\s+)(?=(?:(?:there(?:'s|\s+is|\s+are)|you\s+can\s+see|lots?\s+of|some|visible)\s+)?(?:soap\s+scum|water\s+marks?|fingerprints?|smudges?|streaks?|limescale|cobwebs?|crumbs?|grease|grime|dust|marks?|spills?|stains?)\b)/gi;
  const seen = new Set();
  const tasks = [];
  const rawSections = value
    .slice(0, 5000)
    // The explicit room switch is marked FIRST: the connective replacements
    // below rewrite "and then" and "next" into plain breaks, which would
    // destroy the very move word that identifies an announced room change.
    .replace(explicitRoomSwitch, `.${roomSwitchMark}`)
    .replace(/\bfinally\b/gi, ". __ROOM_RESET__. ")
    .replace(/\b(?:and then|after that|also)\b/gi, ".")
    .replace(/\bnext\b(?!\s+(?:(?:room\s+)?is|we\s+(?:have|enter)))/gi, ".")
    .replace(roomBoundary, ".")
    .replace(bareRoomBoundary, ".")
    .replace(contrastBoundary, ".")
    // A negated verb must never be split from its negation: breaking
    // "don't clean the oven" into "Don't" and "Clean the oven" would publish
    // the exact opposite of the exclusion the customer asked for. The bond is
    // held with a placeholder that no boundary can match, then released.
    .replace(negatedInstruction, (match, negation, verb) => `${negation}${negationBond}${verb}`)
    .replace(imperativeBoundary, ".")
    .replace(spokenPassiveBoundary, ".")
    .split(/[.!?;\n]+/)
    .map((section) => section.split(negationBond).join(" "));
  const sections = rejoinedNegations(rawSections);

  let currentRoom = "";
  let carriedPrefix = "";
  let pendingAnnouncement = false;
  let lastTarget = "";
  for (const rawSection of sections) {
    // A later boundary can fall between the move word and the room it
    // announces ("then | the toilet needs…"), so an announcement that has not
    // reached its room yet is carried to the next segment.
    const announcedRoom = rawSection.startsWith(roomSwitchMark) || pendingAnnouncement;
    pendingAnnouncement = false;
    // A stranded location word belongs to the phrase that follows it, but never
    // across a room announcement — gluing it on there would attach one room's
    // fragment to another room's instruction.
    const startsNewRoom = rawSection.startsWith(roomSwitchMark) || roomPrefix.test(strippedFillers(rawSection));
    const sectionValue = (startsNewRoom ? "" : carriedPrefix) + (rawSection.startsWith(roomSwitchMark) ? rawSection.slice(roomSwitchMark.length) : rawSection);
    carriedPrefix = "";
    let section = strippedFillers(sectionValue);
    if (!section) {
      pendingAnnouncement = announcedRoom;
      continue;
    }
    // A break can land after a preposition that belongs to the next phrase
    // ("inside | of the oven needs cleaning"). Dropping it would quietly turn
    // an oven-interior clean into a generic one, which is a different price.
    if (danglingPrefix(section)) {
      carriedPrefix = `${section} `;
      pendingAnnouncement = announcedRoom;
      continue;
    }
    if (section === "__ROOM_RESET__") {
      currentRoom = "";
      continue;
    }
    const roomMatch = section.match(roomPrefix);
    // An explicit move word ("then the bedroom…") is a room change even when a
    // surface or a description follows it.
    if (roomMatch && (announcedRoom || !fixtureRatherThanRoom(roomMatch[1], currentRoom, roomMatch[0], section.slice(roomMatch[0].length)))) {
      // A pronoun exclusion refers to something in the room being described.
      // Carrying a target across a room change would attach an exclusion to a
      // fixture in a completely different room.
      if (canonicalRoom(roomMatch[1]) !== currentRoom) lastTarget = "";
      currentRoom = canonicalRoom(roomMatch[1]);
      // Filler often sits between the room announcement and the instruction
      // ("the bathroom, yeah, the shower screen…"), so it is stripped again
      // once the room word itself has been removed.
      section = strippedFillers(section.slice(roomMatch[0].length));
      if (!section) continue;
      // The room word can itself be followed by a stranded location word
      // ("in the kitchen inside | of the oven needs cleaning").
      if (danglingPrefix(section)) {
        carriedPrefix = `${section} `;
        continue;
      }
    }
    // A speaker who corrects themselves means the correction, not the false
    // start. This runs after the room is known so that abandoning the false
    // start cannot also discard the room the speaker is standing in.
    const corrected = strippedFillers(section.replace(/^.*?\b(?:sorry,?\s+i\s+mean|no\s+i\s+mean|i\s+mean|scratch\s+that)\b\s*/i, ""));
    if (corrected !== section) {
      section = corrected;
      if (!section) continue;
      // The correction itself may name the room the speaker actually meant.
      const correctedRoom = section.match(roomPrefix);
      if (correctedRoom && canonicalRoom(correctedRoom[1])) {
        currentRoom = canonicalRoom(correctedRoom[1]);
        section = strippedFillers(section.slice(correctedRoom[0].length));
        if (!section) continue;
      }
    }
    // The clause splitters can strand a negation just as the segment splitters
    // can ("don't, clean the oven" breaks on the comma), so the same rejoin is
    // applied here before any clause becomes a published bullet.
    for (const clause of rejoinedNegations(section.split(actionBoundary).flatMap((part) => part.split(passiveBoundary)).flatMap((part) => part.split(conditionBoundary)))) {
      if (navigationOnly(clause)) continue;
      const task = normaliseChecklistTask(clause);
      if (!task || navigationOnly(task)) continue;
      // "clean the oven but don't do it inside" leaves the exclusion pointing at
      // a pronoun. An exclusion the Cleaner cannot resolve is worse than no
      // exclusion at all, so it inherits the target it was spoken about.
      const resolved = lastTarget ? task.replace(/^(Do not [a-z]+)\s+(?:it|them|that|those)$/i, `$1 ${lastTarget}`) : task;
      const conciseTask = currentRoom && !resolved.toLowerCase().startsWith(`${currentRoom.toLowerCase()}:`)
        ? `${currentRoom}: ${resolved}`
        : resolved;
      if (!/^do not\b/i.test(resolved)) lastTarget = spokenTarget(resolved) || lastTarget;
      const key = checklistTaskKey(conciseTask);
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push(conciseTask);
      if (tasks.length === 40) return tasks;
    }
  }
  return tasks;
}
