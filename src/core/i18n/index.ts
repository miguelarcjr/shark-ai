import { ConfigManager } from "../config-manager.js";
import { enUs } from "./locales/en-us.js";
import { esEs } from "./locales/es-es.js";
import { ptBr } from "./locales/pt-br.js";
import { Locale } from "./types.js";

const locales: Record<string, Locale> = {
    'pt-br': ptBr,
    'en-us': enUs,
    'es-es': esEs
};

function getNestedValue(obj: any, path: string): string | undefined {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

export function t(key: string, ...args: string[]): string {
    const config = ConfigManager.getInstance().getConfig();
    const lang = config.language || 'pt-br';

    // Normalize lang just in case
    const normalizedLang = lang.toLowerCase();

    const locale = locales[normalizedLang] || locales['pt-br']; // Fallback to pt-br

    let template = getNestedValue(locale, key);

    if (!template) {
        // Fallback to pt-br if key missing in current language
        template = getNestedValue(locales['pt-br'], key);
    }

    if (!template) {
        return key; // Return key if not found anywhere
    }

    // Simple replacement for {0}, {1}, etc.
    return template.replace(/\{(\d+)\}/g, (match, index) => {
        return typeof args[index] !== 'undefined' ? args[index] : match;
    });
}
