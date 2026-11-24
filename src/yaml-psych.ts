import * as yaml from "js-yaml";

// GitLab loads CI config with Ruby's `YAML.safe_load` (Psych, YAML 1.1). This module resolves plain scalars the way
// Psych::ScalarScanner#tokenize does, so `on`, `0755`, `1:30` and `1.0` mean what they mean on GitLab.

export class PsychDisallowedClass extends Error {
    constructor (readonly className: string, readonly source: string) {
        super(`Tried to load unspecified class: ${className}`);
    }
}

type Token = {kind: "null"} | {kind: "bool"; value: boolean} | {kind: "int"; value: number} | {kind: "float"; value: number} | {kind: "str"};

const STR = {kind: "str"} as const;
const STRINGISH = /^[^\d.:-]?[\p{Alphabetic}_\s!@#$%^&*(){}<>|/\\~;=]+/u;
const TIME = /^-?\d{4}-\d{1,2}-\d{1,2}(?:[Tt]|\s+)\d{1,2}:\d\d:\d\d(?:\.\d*)?(?:\s*(?:Z|[-+]\d{1,2}:?(?:\d\d)?))?$/;
const DATE = /^\d{4}-(?:1[012]|0\d|\d)-(?:[12]\d|3[01]|0\d|\d)$/;
const SEXAGESIMAL_INT = /^[-+]?[0-9][0-9_]*(:[0-5]?[0-9]){1,2}$/;
const SEXAGESIMAL_FLOAT = /^[-+]?[0-9][0-9_]*(:[0-5]?[0-9]){1,2}\.[0-9_]*$/;
const FLOAT = /^[-+]?([0-9][0-9_,]*)?\.[0-9]*([eE][-+][0-9]+)?$/;
// Psych's INTEGER_LEGACY (safe_load does not pass strict_integer), which also allows commas.
const INTEGER = /^(?:[-+]?0b[_,]*[0-1][0-1_,]*|[-+]?0[_,]*[0-7][0-7_,]*|[-+]?(?:0|[1-9](?:[0-9]|,[0-9]|_[0-9])*)|[-+]?0x[_,]*[0-9a-fA-F][0-9a-fA-F_,]*)$/;

// Ruby's String#to_i/to_f accept underscores between digits.
const rubyToI = (s: string) => Number.parseInt(s.replaceAll("_", ""), 10) || 0;
const rubyToF = (s: string) => Number.parseFloat(s.replaceAll("_", "")) || 0;

function sexagesimal (source: string, toNumber: (s: string) => number) {
    return source.split(":").reduce((sum, part, e) => sum + toNumber(part) * 60 ** Math.abs(e - 2), 0);
}

// Ruby's Integer() on Psych's integer forms: 0b binary, 0x hex, leading 0 octal.
function rubyInteger (source: string) {
    const clean = source.replaceAll(/[,_]/g, "");
    const sign = clean.startsWith("-") ? -1 : 1;
    const digits = clean.replace(/^[-+]/, "");
    if (digits.startsWith("0b")) return sign * Number.parseInt(digits.slice(2), 2);
    if (digits.startsWith("0x")) return sign * Number.parseInt(digits.slice(2), 16);
    if (digits.length > 1 && digits.startsWith("0")) return sign * Number.parseInt(digits.slice(1), 8);
    return sign * Number.parseInt(digits, 10);
}

export function tokenize (source: string): Token {
    if (source === "") return {kind: "null"};
    if (STRINGISH.test(source) || source.includes("\n")) {
        if (source.length > 5 || /^[^ytonf~]/i.test(source)) return STR;
        if (source === "~" || /^null$/i.test(source)) return {kind: "null"};
        if (/^(yes|true|on)$/i.test(source)) return {kind: "bool", value: true};
        if (/^(no|false|off)$/i.test(source)) return {kind: "bool", value: false};
        return STR;
    }
    if (TIME.test(source)) throw new PsychDisallowedClass("Time", source);
    if (DATE.test(source)) throw new PsychDisallowedClass("Date", source);
    if (/^\+?\.inf$/i.test(source)) return {kind: "float", value: Infinity};
    if (/^-\.inf$/i.test(source)) return {kind: "float", value: -Infinity};
    if (/^\.nan$/i.test(source)) return {kind: "float", value: NaN};
    if (/^:./.test(source)) return STR; // Psych makes a Symbol; kept as text.
    if (SEXAGESIMAL_INT.test(source)) return {kind: "int", value: sexagesimal(source, rubyToI)};
    if (SEXAGESIMAL_FLOAT.test(source)) return {kind: "float", value: sexagesimal(source, rubyToF)};
    if (FLOAT.test(source)) {
        if (/^[-+]?\.$/.test(source)) return STR;
        const value = Number(source.replaceAll(/[,_]/g, "").replace(/\.([Ee]|$)/, "$1"));
        return Number.isNaN(value) ? STR : {kind: "float", value};
    }
    if (INTEGER.test(source)) return {kind: "int", value: rubyInteger(source)};
    return STR;
}

// Ruby's Float#to_s: always a fraction (`1.0`), exponent form below 1e-4 and from 1e16 (`1.0e+16`, `1.0e-05`).
export function rubyFloatToS (value: number): string {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
    if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
    const abs = Math.abs(value);
    if (abs < 1e-4 || abs >= 1e16) {
        const [mantissa, exponent] = value.toExponential().split("e");
        const digits = exponent.replace(/^[-+]/, "").padStart(2, "0");
        return `${mantissa.includes(".") ? mantissa : `${mantissa}.0`}e${exponent.startsWith("-") ? "-" : "+"}${digits}`;
    }
    const text = String(value);
    return text.includes(".") ? text : `${text}.0`;
}

// A float stays a number when JavaScript prints it like Ruby does (1.5, 3.1). Otherwise it becomes Ruby's text, so
// `VERSION: 1.0` reaches the job as "1.0" just like GitLab's `.to_s`.
export function psychFloat (value: number): number | string {
    const ruby = rubyFloatToS(value);
    return String(value) === ruby ? value : ruby;
}

function scalarTag (tagName: string, kind: Token["kind"], toValue: (token: any) => unknown) {
    return yaml.defineScalarTag(tagName, {
        implicit: true,
        resolve: (source) => {
            const token = tokenize(source);
            return token.kind === kind ? toValue(token) : yaml.NOT_RESOLVED;
        },
        identify: () => false,
    });
}

export const psychTags = [
    scalarTag("tag:yaml.org,2002:null", "null", () => null),
    scalarTag("tag:yaml.org,2002:bool", "bool", (token) => token.value),
    scalarTag("tag:yaml.org,2002:int", "int", (token) => token.value),
    scalarTag("tag:yaml.org,2002:float", "float", (token) => psychFloat(token.value)),
];
