import en from './en';
import de from './de';
import es from './es';
import fr from './fr';
import it from './it';
import ja from './ja';

export enum Language {
    DE = 'de',
    EN = 'en',
    JA = 'ja',
    FR = 'fr',
    IT = 'it',
    ES = 'es',
};

const defaultLang = Language.EN;

export const dictionaries: Record<Language, typeof en> = {
    de, en, ja, fr, it, es
}
