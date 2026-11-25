import { chainTranslations } from "./chain"

const modules = [chainTranslations]

/** Feature-scoped translation tables merged on top of the base dictionary. */
export const featureTranslations: { es: Record<string, string>; en: Record<string, string> } = {
  es: Object.assign({}, ...modules.map((m) => m.es)),
  en: Object.assign({}, ...modules.map((m) => m.en)),
}
