import type { AVATAR_PRESETS } from '@baha/shared/auth';

export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

/** Modular blocky avatar (Section 3.2): colors tint runtime-assembled parts. */
export type AvatarConfig = {
  v: 1;
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'cap' | 'bun' | 'buzz';
  shirt: string;
  pants: string;
  shoes: string;
  hat: string | null;
  accessory: string | null;
  face: 'smile' | 'grin' | 'calm' | 'determined';
};

const P: Record<AvatarPreset, AvatarConfig> = {
  lakeside: {
    v: 1,
    skin: '#C68B59',
    hair: '#1B1B1B',
    hairStyle: 'short',
    shirt: '#2F6F7E',
    pants: '#1E2A38',
    shoes: '#F2EFEA',
    hat: null,
    accessory: null,
    face: 'smile',
  },
  jeepney: {
    v: 1,
    skin: '#A86B3C',
    hair: '#2A1A10',
    hairStyle: 'cap',
    shirt: '#D2402F',
    pants: '#34495E',
    shoes: '#1E2A38',
    hat: 'cap_red',
    accessory: null,
    face: 'grin',
  },
  palengke: {
    v: 1,
    skin: '#E0AC69',
    hair: '#3B2314',
    hairStyle: 'bun',
    shirt: '#F2A516',
    pants: '#5D4037',
    shoes: '#8A6B4A',
    hat: null,
    accessory: 'apron',
    face: 'calm',
  },
  rescuer: {
    v: 1,
    skin: '#8D5524',
    hair: '#111111',
    hairStyle: 'buzz',
    shirt: '#E0672A',
    pants: '#1E2A38',
    shoes: '#111111',
    hat: 'helmet_yellow',
    accessory: 'vest_reflective',
    face: 'determined',
  },
  student: {
    v: 1,
    skin: '#F1C27D',
    hair: '#1B1B1B',
    hairStyle: 'long',
    shirt: '#FFFFFF',
    pants: '#1F3A93',
    shoes: '#111111',
    hat: null,
    accessory: 'backpack_blue',
    face: 'smile',
  },
  fisher: {
    v: 1,
    skin: '#9C6644',
    hair: '#2B2B2B',
    hairStyle: 'short',
    shirt: '#2E8B57',
    pants: '#6B5B45',
    shoes: '#3E3E3E',
    hat: 'salakot',
    accessory: null,
    face: 'calm',
  },
};

export function presetAvatarConfig(preset: AvatarPreset): AvatarConfig {
  return { ...P[preset] };
}

export const AVATAR_PRESET_LIST = Object.entries(P).map(([key, cfg]) => ({
  key: key as AvatarPreset,
  cfg,
}));
