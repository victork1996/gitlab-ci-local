// Ruby's `File.fnmatch?(pattern, path, File::FNM_PATHNAME | File::FNM_DOTMATCH | File::FNM_EXTGLOB)`, which GitLab
// uses for `rules:changes`. Ported from Ruby's dir.c (fnmatch, fnmatch_helper, bracket, ruby_brace_expand):
// `*` and `?` never match `/`, `**/` matches zero or more directories, `{a,b}` braces expand, `[!x]`/`[^x]` negate,
// a backslash escapes the next character and leading dots need no explicit match.

type Cursor = {p: number; s: number};

// A character class starting after `[`. Returns the index after `]` on a match, or -1.
function bracket (pattern: string, p: number, ch: string): number {
    let ok = false;
    let not = false;
    if (p >= pattern.length) return -1;
    if (pattern[p] === "!" || pattern[p] === "^") {
        not = true;
        p++;
    }
    while (pattern[p] !== "]") {
        let t1 = p;
        if (pattern[t1] === "\\") t1++;
        if (t1 >= pattern.length) return -1;
        p = t1 + 1;
        if (p >= pattern.length) return -1;
        if (pattern[p] === "-" && pattern[p + 1] !== "]") {
            let t2 = p + 1;
            if (pattern[t2] === "\\") t2++;
            if (t2 >= pattern.length) return -1;
            p = t2 + 1;
            if (ok) continue;
            const c = ch.codePointAt(0)!;
            if (c >= pattern.codePointAt(t1)! && c <= pattern.codePointAt(t2)!) ok = true;
            continue;
        }
        if (!ok && pattern[t1] === ch) ok = true;
    }
    return ok === not ? -1 : p + 1;
}

// Matches one path segment; on success the cursor stops where the pattern and string segments ended.
function matchSegment (pattern: string, str: string, cursor: Cursor): boolean {
    const isEnd = (text: string, i: number) => i >= text.length || text[i] === "/";
    const unescape = (i: number) => pattern[i] === "\\" ? i + 1 : i;
    let {p, s} = cursor;
    let pStar = -1;
    let sStar = -1;
    const done = (matched: boolean) => {
        cursor.p = p;
        cursor.s = s;
        return matched;
    };
    for (;;) {
        if (pattern[p] === "*") {
            do p++; while (pattern[p] === "*");
            if (isEnd(pattern, unescape(p))) {
                p = unescape(p);
                return done(true);
            }
            if (isEnd(str, s)) return done(false);
            pStar = p;
            sStar = s;
            continue;
        }
        let failed = false;
        if (pattern[p] === "?") {
            if (isEnd(str, s)) return done(false);
            p++;
            s++;
            continue;
        }
        if (pattern[p] === "[") {
            if (isEnd(str, s)) return done(false);
            const next = bracket(pattern, p + 1, str[s]);
            if (next !== -1) {
                p = next;
                s++;
                continue;
            }
            failed = true;
        }
        if (!failed) {
            p = unescape(p);
            if (isEnd(str, s)) return done(isEnd(pattern, p));
            if (!isEnd(pattern, p) && pattern[p] === str[s]) {
                p++;
                s++;
                continue;
            }
        }
        // Retry from the last `*`, letting it swallow one more character.
        if (pStar === -1) return done(false);
        p = pStar;
        s = ++sStar;
    }
}

function fnmatchPathname (pattern: string, str: string): boolean {
    let p = 0;
    let s = 0;
    let pGlobstar = -1;
    let sGlobstar = -1;
    for (;;) {
        if (pattern.startsWith("**/", p)) {
            do p += 3; while (pattern.startsWith("**/", p));
            pGlobstar = p;
            sGlobstar = s;
        }
        const cursor = {p, s};
        if (matchSegment(pattern, str, cursor)) {
            p = cursor.p;
            s = cursor.s;
            while (s < str.length && str[s] !== "/") s++;
            if (p < pattern.length && s < str.length) {
                p++;
                s++;
                continue;
            }
            if (p >= pattern.length && s >= str.length) return true;
        }
        // `**/` takes one more directory and the rest of the pattern tries again.
        if (pGlobstar !== -1) {
            while (sGlobstar < str.length && str[sGlobstar] !== "/") sGlobstar++;
            if (sGlobstar < str.length) {
                p = pGlobstar;
                s = ++sGlobstar;
                continue;
            }
        }
        return false;
    }
}

// Ruby's ruby_brace_expand: an unbalanced brace expands to nothing, so it never matches.
export function braceExpand (pattern: string): string[] {
    let lbrace = -1;
    let rbrace = -1;
    let nest = 0;
    for (let p = 0; p < pattern.length; p++) {
        if (pattern[p] === "{" && nest++ === 0) lbrace = p;
        if (pattern[p] === "}" && lbrace !== -1 && --nest === 0) {
            rbrace = p;
            break;
        }
        if (pattern[p] === "\\" && ++p >= pattern.length) break;
    }
    if (lbrace === -1 && rbrace === -1) return [pattern];
    if (lbrace === -1 || rbrace === -1) return [];

    const expanded: string[] = [];
    let p = lbrace;
    while (p < rbrace) {
        const t = ++p;
        nest = 0;
        while (p < rbrace && !(pattern[p] === "," && nest === 0)) {
            if (pattern[p] === "{") nest++;
            if (pattern[p] === "}") nest--;
            if (pattern[p] === "\\" && ++p === rbrace) break;
            p++;
        }
        expanded.push(...braceExpand(pattern.slice(0, lbrace) + pattern.slice(t, p) + pattern.slice(rbrace + 1)));
    }
    return expanded;
}

export function fnmatch (pattern: string, path: string): boolean {
    return braceExpand(pattern).some(expanded => fnmatchPathname(expanded, path));
}
