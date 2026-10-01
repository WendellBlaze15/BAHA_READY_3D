/**
 * "Mga Natutunan" (Section 14.4): every learning event key the game server records, grouped as
 * done right / could improve / dangerous, with a short bilingual explanation and the Tips
 * Library mistake key it unlocks. Health lessons: VERIFY WITH DOH/MDRRMO before public release.
 */
export type LessonKind = 'good' | 'improve' | 'danger';

export interface Lesson {
  kind: LessonKind;
  fil: string;
  en: string;
  /** tips.unlock_rule {"type":"mistake","key": …} unlocked for the player. */
  tip?: string;
}

export const LESSONS: Record<string, Lesson> = {
  drank_boiled_water: {
    kind: 'good',
    fil: 'Pinakuluan ang tubig bago inumin — ito ang pinakaligtas.',
    en: 'Boiled water before drinking — the safest choice.',
  },
  drank_safe_water: { kind: 'good', fil: 'Uminom ng malinis na tubig.', en: 'Drank clean water.' },
  used_water_filter: {
    kind: 'good',
    fil: 'Sinala ang tubig. Mas ligtas pa rin kung pakukuluan din.',
    en: 'Filtered water. Boiling it too is safer still.',
  },
  drank_unsafe_water: {
    kind: 'improve',
    fil: 'Uminom ng maduming tubig. Pakuluan o salain muna para iwas sakit sa tiyan.',
    en: 'Drank unsafe water. Boil or filter it first to avoid stomach illness.',
    tip: 'missing_drinking_water',
  },
  cooked_food: { kind: 'good', fil: 'Niluto ang pagkain.', en: 'Cooked food properly.' },
  bandaged_wound: {
    kind: 'good',
    fil: 'Tinakpan ang sugat bago lumapit sa baha.',
    en: 'Covered wounds before going near floodwater.',
  },
  used_first_aid: { kind: 'good', fil: 'Gumamit ng first-aid kit.', en: 'Used a first-aid kit.' },
  took_medicine: {
    kind: 'good',
    fil: 'Nagpagamot. Sa totoong buhay, magpatingin sa health worker.',
    en: 'Got treatment. In real life, see a health worker.',
  },
  cleaned_wound: { kind: 'good', fil: 'Nilinis ang sugat.', en: 'Cleaned a wound.' },
  changed_dry_clothes: {
    kind: 'good',
    fil: 'Nagpalit agad ng tuyong damit para iwas ginaw.',
    en: 'Changed into dry clothes right away to stay warm.',
  },
  wore_boots: {
    kind: 'good',
    fil: 'Nagsuot ng bota sa baha — proteksyon sa leptospirosis at sugat.',
    en: 'Wore boots in floodwater — protection from leptospirosis and cuts.',
  },
  boots_prevented_bite: {
    kind: 'good',
    fil: 'Napigilan ng bota ang kagat ng daga.',
    en: 'Boots prevented a rat bite.',
  },
  wore_life_vest: { kind: 'good', fil: 'Nagsuot ng life vest.', en: 'Wore a life vest.' },
  listened_to_radio: {
    kind: 'good',
    fil: 'Nakinig sa opisyal na abiso sa radyo.',
    en: 'Listened to official radio advisories.',
    tip: 'missing_radio',
  },
  used_right_tool: {
    kind: 'good',
    fil: 'Gumamit ng tamang kagamitan at umiwas sa hayop sa baha.',
    en: 'Used the right tool and kept animals in the flood away.',
  },
  built_boat_stage: {
    kind: 'good',
    fil: 'Tumulong sa paggawa ng bangka.',
    en: 'Helped build the boat.',
  },
  revived_teammate: {
    kind: 'good',
    fil: 'Tinulungan ang kasamang nasugatan.',
    en: 'Helped an injured teammate.',
  },
  helped_survivor: {
    kind: 'good',
    fil: 'Tinulungan ang na-stranded na kapitbahay.',
    en: 'Helped a stranded neighbor.',
  },
  lit_signal_fire: {
    kind: 'good',
    fil: 'Gumamit ng apoy para makita ng rescuers.',
    en: 'Used fire so rescuers could see you.',
    tip: 'missing_whistle',
  },
  signaled_rescuers: {
    kind: 'good',
    fil: 'Gumamit ng salamin, flare, o pito para makita ng rescuers.',
    en: 'Used a mirror, flare, or whistle so rescuers could see you.',
    tip: 'missing_whistle',
  },
  rescued: { kind: 'good', fil: 'Nailigtas ng rescue team.', en: 'Rescued by the rescue team.' },
  got_leptospirosis_risk: {
    kind: 'improve',
    fil: 'Lumusong sa baha nang may sugat at walang bota. Magpatingin kapag nilagnat.',
    en: 'Waded with an open wound and no boots. See a doctor if you get a fever.',
  },
  got_hypothermia: {
    kind: 'improve',
    fil: 'Nilamig nang husto. Magpalit ng tuyong damit at lumapit sa apoy.',
    en: 'Got dangerously cold. Change into dry clothes and get near a fire.',
  },
  rat_bite: {
    kind: 'improve',
    fil: 'Nakagat ng daga sa baha. Magsuot ng bota at iwasan ang mga hayop.',
    en: 'Bitten by a rat in floodwater. Wear boots and avoid animals.',
  },
  snake_bite: {
    kind: 'danger',
    fil: 'Nakagat ng ahas. Lumayo sa damuhan at gilid ng tubig.',
    en: 'Bitten by a snake. Stay away from grass and water edges.',
  },
  entered_live_wire_water: {
    kind: 'danger',
    fil: 'Lumapit sa tubig na may live wire. Huwag kailanman lumusong malapit sa natumbang kable.',
    en: 'Went into water near live wires. Never enter water near fallen wires.',
    tip: 'live_wire',
  },
  swam_in_current: {
    kind: 'danger',
    fil: 'Lumangoy sa malakas na agos. Iwasan ang malalim at mabilis na tubig.',
    en: 'Swam in a strong current. Avoid deep, fast water.',
    tip: 'strong_current',
  },
  stayed_in_collapsing_building: {
    kind: 'danger',
    fil: 'Nanatili sa gusaling gumuguho. Lumabas agad kapag yumanig.',
    en: 'Stayed in a collapsing building. Get out as soon as it shakes.',
    tip: 'collapsing_structure',
  },
};

/** Crafting lessons are recorded as `crafted_<recipe>` (the recipe's own lesson text). */
export function lessonFor(key: string): Lesson | null {
  if (LESSONS[key]) return LESSONS[key]!;
  if (key.startsWith('crafted_'))
    return { kind: 'good', fil: 'Gumawa ng kailangan.', en: 'Crafted something useful.' };
  return null;
}
