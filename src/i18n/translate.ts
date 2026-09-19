import { Fragment, createElement, type ReactNode } from "react";
import { CATALOGUES, type Catalogue, type MessageKey } from "./catalogues";
import type { Language } from "./languages";

export type MessageValues = Record<string, string | number>;

// Text held in state (toasts, blocking errors, load failures) is a key plus
// values, never a finished string, so it renders in whatever language is
// current when it is shown.
export type Message = {
  key: MessageKey;
  values?: MessageValues;
};

export function message(key: MessageKey, values?: MessageValues): Message {
  return values === undefined ? { key } : { key, values };
}

const PLACEHOLDER = /\{(\w+)\}/g;

export type Translator = {
  language: Language;
  locale: string;
  t: (key: MessageKey, values?: MessageValues) => string;
  // Like t, but a placeholder may be filled with markup (a <code> path, say).
  rich: (key: MessageKey, values: Record<string, ReactNode>) => ReactNode;
  text: (message: Message) => string;
  number: (value: number) => string;
  percent: (ratio: number) => string;
  dateTime: (date: Date) => string;
};

export function createTranslator(language: Language, locale: string = language): Translator {
  const catalogue: Catalogue = CATALOGUES[language];
  const numberFormat = new Intl.NumberFormat(locale);
  const percentFormat = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 });
  const dateTimeFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const pluralRules = new Intl.PluralRules(language);

  function template(key: MessageKey, values: MessageValues | undefined): string {
    const entry = catalogue[key];
    if (typeof entry === "string") {
      return entry;
    }
    // A plural entry holds one form per CLDR category the language uses; the
    // catalogue gate guarantees the category the rules select is present.
    const count = typeof values?.count === "number" ? values.count : 0;
    const forms = entry as Record<string, string>;
    return forms[pluralRules.select(count)] ?? forms.other;
  }

  function format(value: string | number): string {
    return typeof value === "number" ? numberFormat.format(value) : value;
  }

  function t(key: MessageKey, values?: MessageValues): string {
    return template(key, values).replace(PLACEHOLDER, (whole, name: string) =>
      values !== undefined && name in values ? format(values[name]) : whole,
    );
  }

  function rich(key: MessageKey, values: Record<string, ReactNode>): ReactNode {
    const parts = template(key, undefined).split(PLACEHOLDER);
    // split with a capture group alternates literal text and placeholder names.
    return parts.map((part, index) =>
      index % 2 === 0
        ? part
        : createElement(Fragment, { key: index }, part in values ? values[part] : `{${part}}`),
    );
  }

  return {
    language,
    locale,
    t,
    rich,
    text: (message) => t(message.key, message.values),
    number: (value) => numberFormat.format(value),
    percent: (ratio) => percentFormat.format(ratio),
    dateTime: (date) => dateTimeFormat.format(date),
  };
}
