import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary } from '@zxcvbn-ts/language-common';

let factory: ZxcvbnFactory | undefined;
function getFactory() {
  factory ??= new ZxcvbnFactory({
    graphs: adjacencyGraphs,
    dictionary: {
      ...dictionary,
      // Local words that make passwords guessable.
      userInputs: ['baha', 'bahaready', 'pila', 'laguna', 'bagyo', 'signal', 'password', 'qwerty'],
    },
  });
  return factory;
}

/** zxcvbn score 0–4. The app requires ≥ 3 (Section 12). */
export function passwordScore(password: string, userInputs: string[] = []) {
  return getFactory().check(password, userInputs).score;
}

export const MIN_PASSWORD_SCORE = 3;
