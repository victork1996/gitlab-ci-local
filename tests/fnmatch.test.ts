import {braceExpand, fnmatch} from "../src/fnmatch.js";

// Expectations follow Ruby's File.fnmatch?(pattern, path, File::FNM_PATHNAME | File::FNM_DOTMATCH | File::FNM_EXTGLOB).
test.each([
    ["*.ts", "main.ts", true],
    ["*.ts", "src/main.ts", false],
    ["*", ".gitlab-ci.yml", true],
    ["src/*", "src/a/b.ts", false],
    ["src/**/*.ts", "src/main.ts", true],
    ["src/**/*.ts", "src/a/b/main.ts", true],
    ["**/*.ts", "main.ts", true],
    ["**/*.ts", "a/.hidden/main.ts", true],
    ["**/Dockerfile", "docker/Dockerfile", true],
    ["src/**", "src/a", true],
    ["src/**", "src/a/b", false],
    ["src/**.ts", "src/a/b.ts", false],
    ["a?c", "abc", true],
    ["a?c", "a/c", false],
    ["{src,lib}/*.{ts,js}", "lib/x.js", true],
    ["{src,lib}/*.{ts,js}", "test/x.js", false],
    ["{a,{b,c}}.txt", "c.txt", true],
    ["{a,b.txt", "a", false],
    ["[abc].txt", "b.txt", true],
    ["[!abc].txt", "b.txt", false],
    ["[^abc].txt", "d.txt", true],
    ["[a-c].txt", "b.txt", true],
    ["[a-c].txt", "d.txt", false],
    ["a[/]b", "a/b", false],
    [String.raw`\*.txt`, "*.txt", true],
    [String.raw`\*.txt`, "a.txt", false],
    [String.raw`a\{b,c}`, "a{b,c}", true],
    ["docs/*.md", "docs/README.md", true],
    ["README.md", "readme.md", false],
    ["Dockerfile", "Dockerfile", true],
    ["Dockerfile", "docker/Dockerfile", false],
])("fnmatch(%s, %s) is %s", (pattern, path, expected) => {
    expect(fnmatch(pattern, path)).toBe(expected);
});

test("braceExpand", () => {
    expect(braceExpand("a{b,c{d,e}}f")).toEqual(["abf", "acdf", "acef"]);
    expect(braceExpand(String.raw`a\{b,c}`)).toEqual([String.raw`a\{b,c}`]);
    expect(braceExpand("{}")).toEqual([""]);
});
