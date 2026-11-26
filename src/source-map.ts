import {AssertionError} from "node:assert";
import path from "node:path";
import * as yaml from "js-yaml";

// Where a value was written: a file, a 1-based line and column, and the column its text ends before on that line.
export interface SourceLocation {
    file: string;
    line: number;
    column: number;
    endColumn: number;
}

export type SourcePath = ReadonlyArray<string | number>;

// What a configuration error is about, for Parser.create to find in the files:
//  - a value by its path in the merged configuration (["build-job", "needs", 0]),
//  - a value by its path in one loaded file (the object Parser.loadYaml returned),
//  - a `!reference [a, b]` by its parts, or
//  - the place itself.
export type SourceWhere =
    {path: SourcePath; data?: unknown} |
    {reference: ReadonlyArray<unknown>} |
    {location: SourceLocation};

// Offsets into the parsed text: of a mapping key (-1 for a list item) and of its value. valueEnd is -1 for a
// mapping or a list, which the parser gives no end of.
interface Span {
    keyStart: number;
    keyEnd: number;
    valueStart: number;
    valueEnd: number;
}

interface Frame {
    kind: "document" | "sequence" | "mapping";
    path: string[] | null;
    index: number;
    // In a mapping: undefined while a key is expected, then the key, or null for a key that is not plain text.
    key: {text: string; start: number; end: number} | null | undefined;
    isKey?: boolean;
    reference?: {parts: string[]; start: number; end: number};
}

const QUOTED: ReadonlySet<number> = new Set([yaml.SCALAR_STYLE_SINGLE_QUOTED, yaml.SCALAR_STYLE_DOUBLE_QUOTED]);
const pathKey = (parts: SourcePath) => parts.join("\0");

// The positions of one loaded pipeline file.
export class SourceFile {
    private readonly spans = new Map<string, Span>();
    private readonly references: {parts: string[]; start: number; end: number}[] = [];
    // The jobs each job extends, as written in this file.
    private readonly parents = new Map<string, string[]>();
    private readonly lineStarts: number[] = [0];

    // text: what was parsed. lines: for each line of it, its 1-based line in the file (Parser.loadYaml adds lines).
    constructor (readonly file: string, private readonly text: string, private readonly lines: number[], events: yaml.Event[]) {
        for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) this.lineStarts.push(at + 1);
        this.read(events);
    }

    // The line of each line of `parsed` in `original`, when `parsed` is `original` with lines added.
    static lineNumbers (original: string[], parsed: string[]): number[] {
        const lines: number[] = [];
        let at = 0;
        for (const line of parsed) {
            if (at < original.length && line === original[at]) at++;
            lines.push(Math.max(1, at));
        }
        return lines;
    }

    private read (events: yaml.Event[]) {
        const stack: Frame[] = [];
        // A list item or a mapping value ended: the next node is the next item, or a key.
        const closed = () => {
            const parent = stack.at(-1);
            if (parent?.kind === "sequence") parent.index++;
            else if (parent?.kind === "mapping") parent.key = undefined;
        };
        // A node's path (null when a key above it is not plain text), or "key" for a mapping key. Records where it is.
        const place = (start: number, end: number): string[] | null | "key" => {
            const parent = stack.at(-1);
            if (!parent || parent.kind === "document") return [];
            if (parent.kind === "mapping" && parent.key === undefined) return "key";
            if (parent.path == null || parent.key === null) return null;
            const parts = [...parent.path, parent.kind === "sequence" ? String(parent.index) : parent.key!.text];
            this.spans.set(pathKey(parts), {keyStart: parent.key?.start ?? -1, keyEnd: parent.key?.end ?? -1, valueStart: start, valueEnd: end});
            return parts;
        };
        for (const event of events) {
            switch (event.type) {
                case yaml.EVENT_DOCUMENT:
                    stack.push({kind: "document", path: [], index: 0, key: undefined});
                    break;
                case yaml.EVENT_POP: {
                    const frame = stack.pop();
                    if (frame?.reference) this.references.push(frame.reference);
                    if (frame?.isKey) stack.at(-1)!.key = null;
                    else if (frame && frame.kind !== "document") closed();
                    break;
                }
                case yaml.EVENT_SEQUENCE:
                case yaml.EVENT_MAPPING: {
                    const at = place(event.start, -1);
                    const frame: Frame = {kind: event.type === yaml.EVENT_SEQUENCE ? "sequence" : "mapping", path: at === "key" ? null : at, index: 0, key: undefined, isKey: at === "key"};
                    if (frame.kind === "sequence" && event.tagStart >= 0 && this.text.slice(event.tagStart, event.tagEnd) === "!reference") {
                        frame.reference = {parts: [], start: event.tagStart, end: event.start + 1};
                    }
                    stack.push(frame);
                    break;
                }
                case yaml.EVENT_SCALAR: {
                    const quote = QUOTED.has(event.style) ? 1 : 0;
                    const start = event.valueStart - quote, end = event.valueEnd + quote;
                    const parent = stack.at(-1);
                    if (parent?.reference) {
                        parent.reference.parts.push(yaml.getScalarValue(this.text, event));
                        const close = this.text.indexOf("]", end);
                        parent.reference.end = close >= 0 && !this.text.slice(end, close).includes("\n") ? close + 1 : end;
                    }
                    const at = place(start, end);
                    if (at === "key") {
                        parent!.key = {text: yaml.getScalarValue(this.text, event), start, end};
                        break;
                    }
                    if (at && at[1] === "extends" && at.length <= 3) {
                        this.parents.set(at[0], [...this.parents.get(at[0]) ?? [], yaml.getScalarValue(this.text, event)]);
                    }
                    closed();
                    break;
                }
                case yaml.EVENT_ALIAS:
                    if (place(event.anchorStart - 1, event.anchorEnd) === "key") stack.at(-1)!.key = null;
                    else closed();
                    break;
            }
        }
    }

    // The place of the text from one offset to another: its first line only.
    at (start: number, end: number = start + 1): SourceLocation {
        start = Math.max(0, Math.min(start, this.text.length));
        let low = 0, high = this.lineStarts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (this.lineStarts[middle] <= start) low = middle; else high = middle - 1;
        }
        const lineStart = this.lineStarts[low];
        const next = this.text.indexOf("\n", lineStart);
        const lineEnd = next < 0 ? this.text.length : next;
        const column = start - lineStart + 1;
        return {
            file: this.file,
            line: this.lines[low] ?? low + 1,
            column,
            endColumn: Math.max(column + 1, Math.min(end, lineEnd) - lineStart + 1),
        };
    }

    // How many leading parts of a path this file has a value for.
    depth (parts: SourcePath): number {
        for (let depth = parts.length; depth > 0; depth--) {
            if (this.spans.has(pathKey(parts.slice(0, depth)))) return depth;
        }
        return 0;
    }

    // The value at a path: its text when it is a single value, else its key. atKey: the key in any case.
    locate (parts: SourcePath, atKey = false): SourceLocation | undefined {
        const span = this.spans.get(pathKey(parts));
        if (!span) return undefined;
        if (span.valueEnd >= 0 && !(atKey && span.keyStart >= 0)) return this.at(span.valueStart, span.valueEnd);
        if (span.keyStart >= 0) return this.at(span.keyStart, span.keyEnd);
        // A list item that is a mapping or a list: its first line, without a comment.
        const rest = /^.*?(?=\s+#|\s*$)/m.exec(this.text.slice(span.valueStart))?.[0] ?? "";
        return this.at(span.valueStart, span.valueStart + rest.length);
    }

    extended (job: string): string[] {
        return this.parents.get(job) ?? [];
    }

    locateReference (parts: ReadonlyArray<unknown>): SourceLocation | undefined {
        const wanted = parts.map(String).join("\0");
        const found = this.references.find(reference => reference.parts.join("\0") === wanted);
        return found && this.at(found.start, found.end);
    }
}

// Parser.loadYaml records each file it reads by the data it returned, so nothing has to be passed along.
const loaded = new WeakMap<object, SourceFile>();

export function recordSource (data: unknown, source: SourceFile | undefined) {
    if (source && data != null && typeof data === "object") loaded.set(data, source);
}

export const sourceOf = (data: unknown): SourceFile | undefined => data != null && typeof data === "object" ? loaded.get(data) : undefined;

// The files of one pipeline, in the order they are merged: a later file overrides an earlier one.
export class Sources {
    private files: SourceFile[] = [];

    constructor (private readonly cwd: string) {}

    setFiles (datas: unknown[]) {
        this.files = datas.map(sourceOf).filter(file => file !== undefined);
    }

    private relative (location: SourceLocation | undefined): SourceLocation | undefined {
        if (!location) return undefined;
        const file = path.isAbsolute(location.file) ? path.relative(this.cwd, location.file) : location.file;
        return {...location, file: file.split(path.sep).join("/")};
    }

    // The value at a path of the merged configuration, or the closest value above it that a file has: a key a
    // job inherits is in no file under that job.
    locate (parts: SourcePath, atKey = false): SourceLocation | undefined {
        const found = this.deepest(parts, new Set());
        return this.relative(found.file?.locate(found.parts, atKey && found.parts.length === parts.length));
    }

    // The longest start of a path that a file has, in the job itself or in a job it extends.
    private deepest (parts: SourcePath, seen: Set<string>): {file?: SourceFile; parts: SourcePath} {
        let best: {file?: SourceFile; parts: SourcePath} = {parts: []};
        for (const file of this.files) {
            const own = file.depth(parts);
            if (own > 0 && own >= best.parts.length) best = {file, parts: parts.slice(0, own)};
        }
        const job = String(parts[0]);
        if (best.parts.length === parts.length || parts.length < 2 || seen.has(job)) return best;
        seen.add(job);
        // The last parent that has the key is the one the job gets it from.
        for (const parent of this.files.flatMap(file => file.extended(job))) {
            const inherited = this.deepest([parent, ...parts.slice(1)], seen);
            if (inherited.parts.length > 1 && inherited.parts.length >= best.parts.length) best = inherited;
        }
        return best;
    }

    resolve (where: SourceWhere): SourceLocation | undefined {
        if ("location" in where) return this.relative(where.location);
        if ("reference" in where) {
            for (const file of this.files) {
                const found = file.locateReference(where.reference);
                if (found) return this.relative(found);
            }
            return undefined;
        }
        if (where.data === undefined) return this.locate(where.path);
        const file = sourceOf(where.data);
        return this.relative(file?.locate(where.path.slice(0, file.depth(where.path))));
    }
}

// about: the value the place is of, when an error has several places.
export const formatLocation = (location: SourceLocation, about?: string) => `--> ${location.file}:${location.line}:${location.column}-${location.endColumn}${about ? ` (${about})` : ""}`;

// A configuration error that knows what it is about. `location` is set once the files are known.
export class ConfigError extends AssertionError {
    where?: SourceWhere;
    location?: SourceLocation;
    // For an error that lists several problems: the place of each, by the value it names.
    locations?: {location: SourceLocation; about: string}[];

    constructor (message: string, where?: SourceWhere) {
        super({message});
        this.where = where;
    }
}

export function configAssert (value: unknown, message: string, where: SourceWhere): asserts value {
    if (!value) throw new ConfigError(message, where);
}

// Says what an error is about, unless it already knows.
export function withWhere (error: unknown, where: SourceWhere): unknown {
    if (error instanceof Error && (error as ConfigError).where === undefined && (error as ConfigError).location === undefined) {
        (error as ConfigError).where = where;
    }
    return error;
}

export function resolveLocation (error: unknown, sources: Sources): unknown {
    const located = error as ConfigError;
    if (error instanceof Error && located.where !== undefined && located.location === undefined) {
        located.location = sources.resolve(located.where);
    }
    return error;
}
