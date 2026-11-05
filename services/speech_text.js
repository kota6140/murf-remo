/**
 * services/speech_text.js
 *
 * Small text clean-ups applied only to the words sent to the voice, never to the transcript or the
 * dashboard. A title in front of a name is spoken as a word: "Dr. Ravi" is "Doctor Ravi", not "D R Ravi".
 *
 * A title is expanded only when a name follows it, so words such as "Andre", "Drive" or a street
 * ending in "Dr" are left alone.
 */

const DEVANAGARI = /[ऀ-ॿ]/;
const TELUGU = /[ఀ-౿]/;

const DOCTOR = { en: 'Doctor', hi: 'डॉक्टर', te: 'డాక్టర్' };
const OTHER_TITLES = { mr: 'Mister', mrs: 'Missus', ms: 'Miss', prof: 'Professor' };

// A name follows: a letter in Latin, Devanagari or Telugu script (after a full stop and/or spaces).
const NAME_AHEAD = '(?:\\.\\s*|\\s+)(?=[A-Za-z\\u0900-\\u097F\\u0C00-\\u0C7F])';
const DOCTOR_RE = new RegExp(`(?<![A-Za-z0-9])dr${NAME_AHEAD}`, 'gi');
const OTHER_RE = new RegExp(`(?<![A-Za-z0-9])(mrs|mr|ms|prof)${NAME_AHEAD}`, 'gi');

/** Language of the line, read from its script: Hindi and Telugu lines say the title in that language. */
function doctorWord(text) {
    if (DEVANAGARI.test(text)) return DOCTOR.hi;
    if (TELUGU.test(text)) return DOCTOR.te;
    return DOCTOR.en;
}

/** "Dr. Ravi" -> "Doctor Ravi"; also Mr, Mrs, Ms and Prof. Anything else is returned unchanged. */
export function expandTitles(text) {
    if (typeof text !== 'string' || !text) return text;
    const doctor = doctorWord(text);
    return text
        .replace(DOCTOR_RE, `${doctor} `)
        .replace(OTHER_RE, (_, title) => `${OTHER_TITLES[title.toLowerCase()]} `);
}

export default { expandTitles };
