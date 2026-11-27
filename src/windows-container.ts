import micromatch from "micromatch";
import {Shell} from "./shell.js";

// Windows container jobs: GitLab's docker-windows executor runs them with PowerShell in
// C:\builds\<group>\<project>. A job is one when GitLab would hand it to a Windows runner: its tags
// mention windows, or its image is a Windows base image.

export const WINDOWS_BUILDS_DIR = "C:\\builds";
export const WINDOWS_FILE_VARIABLES_DIR = "C:\\gcl-file-variables";
export const WINDOWS_SCRIPTS_DIR = "C:\\gcl-scripts";
export const WINDOWS_COPY_IN_DIR = "C:\\gcl-copy-in";
export const WINDOWS_COPY_OUT_DIR = "C:\\gcl-copy-out";
export const POWERSHELL = ["powershell", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];

export function isWindowsImage (image: string | null | undefined): boolean {
    if (!image) return false;
    const name = image.toLowerCase();
    // mcr.microsoft.com/windows[/servercore|/nanoserver|/server], …-windowsservercore-…, dotnet/framework, …
    return /(^|\/)windows(\/|:|@|$)/.test(name) ||
        /(servercore|nanoserver|windowsservercore)/.test(name) ||
        /(^|\/)dotnet\/framework\//.test(name);
}

// imageOs holds operating systems read from the images themselves (--image-os image=os, as
// Pipeline Play passes from the image's manifest); the name check is only a fallback for the rest.
export function isWindowsContainerJob (image: string | null | undefined, tags: unknown, imageOs: {[image: string]: string} = {}): boolean {
    if (!image) return false;
    const tagged = Array.isArray(tags) && tags.some((tag) => typeof tag === "string" && /windows/i.test(tag));
    if (tagged) return true;
    const known = imageOs[image];
    return known ? known === "windows" : isWindowsImage(image);
}

/** Parses --image-os values ("image=os"); the image name is everything before the last "=". */
export function parseImageOs (values: string[]): {[image: string]: string} {
    const result: {[image: string]: string} = {};
    for (const value of values) {
        const at = value.lastIndexOf("=");
        if (at > 0) result[value.slice(0, at)] = value.slice(at + 1).toLowerCase();
    }
    return result;
}

export function windowsProjectDir (group: string, project: string): string {
    return [WINDOWS_BUILDS_DIR, ...`${group}/${project}`.split("/").filter(Boolean)].join("\\");
}

/** A PowerShell single-quoted string literal. */
export function psQuote (value: string): string {
    return `'${value.replaceAll("'", "''")}'`;
}

// The script a job container runs. Each command is echoed with the prompt placeholder (the runner
// prints it as `$ command`), and the script stops at the first failing command with its exit code,
// as GitLab's PowerShell shell does.
export function powershellJobScript (scripts: string[], {projectDir, promptPlaceholder, jobStatus}: {projectDir: string; promptPlaceholder: string; jobStatus?: string}): string {
    let cmd = "$ErrorActionPreference = 'Stop'\r\n";
    cmd += "$ProgressPreference = 'SilentlyContinue'\r\n";
    cmd += "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\r\n";
    cmd += `Set-Location -LiteralPath ${psQuote(projectDir)}\r\n`;
    if (jobStatus && jobStatus !== "running") {
        // after_script sees the job's result, as on GitLab.
        cmd += `$env:CI_JOB_STATUS = ${psQuote(jobStatus)}\r\n`;
    }
    for (const script of scripts) {
        const lines = script.split(/\r?\n/);
        const collapsed = lines.length > 1 ? " # collapsed multi-line command" : "";
        cmd += `Write-Output ${psQuote(`${promptPlaceholder} ${lines[0]}${collapsed}`)}\r\n`;
        cmd += `${lines.join("\r\n")}\r\n`;
        cmd += "if (!$?) { exit $(if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }) }\r\n";
    }
    cmd += "exit 0\r\n";
    return cmd;
}

// PowerShell reads a BOM-less script as the system code page; the BOM keeps non-ASCII text intact.
export const UTF8_BOM = "\uFEFF";

/** Copies everything from the mounted source folder into the destination, hidden files included. */
export function robocopyCommand (source: string, destination: string): string {
    return `robocopy ${psQuote(source)} ${psQuote(destination)} /E /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { exit $LASTEXITCODE } else { exit 0 }`;
}

function relativePattern (pattern: string, projectDir: string): string {
    let p = pattern.replaceAll("\\", "/");
    const dir = projectDir.replaceAll("\\", "/");
    if (p.toLowerCase().startsWith(dir.toLowerCase() + "/")) p = p.slice(dir.length + 1);
    return p.replace(/^\.\//, "");
}

/**
 * A PowerShell command that copies the files matching `patterns` (globs relative to the project,
 * as in artifacts:paths and cache:paths) from the project directory into `destination`, keeping
 * their relative paths. A matching directory brings everything below it. `exclude` patterns
 * (artifacts:exclude) and the state directory are left out. Matching is case-insensitive, like the
 * Windows file system.
 */
export function copyMatchesCommand ({patterns, exclude = [], destination, projectDir, stateDir}: {patterns: string[]; exclude?: string[]; destination: string; projectDir: string; stateDir: string}): string {
    const regex = (p: string) => micromatch.makeRe(relativePattern(p, projectDir), {dot: true, nocase: true}).source;
    const include = patterns.map((p) => ({base: micromatch.scan(relativePattern(p, projectDir)).base || ".", regex: regex(p)}));
    const excluded = [...exclude.map(regex), micromatch.makeRe(`${stateDir}/**`, {dot: true, nocase: true}).source];
    let cmd = "$ErrorActionPreference = 'Stop'\r\n";
    cmd += `$root = (Resolve-Path -LiteralPath ${psQuote(projectDir)}).Path.TrimEnd('\\')\r\n`;
    cmd += `$destination = ${psQuote(destination)}\r\n`;
    cmd += `$exclude = @(${excluded.map(psQuote).join(", ")})\r\n`;
    cmd += "function Get-Relative($item) { $item.FullName.Substring($root.Length + 1).Replace('\\', '/') }\r\n";
    cmd += "function Test-Excluded($relative) { foreach ($e in $exclude) { if ($relative -match $e) { return $true } }; return $false }\r\n";
    cmd += "$selected = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)\r\n";
    for (const {base, regex: pattern} of include) {
        cmd += `$base = Join-Path $root ${psQuote(base.replaceAll("/", "\\"))}\r\n`;
        cmd += "if (Test-Path -LiteralPath $base) {\r\n";
        cmd += "  $items = @(Get-Item -LiteralPath $base -Force) + @(if ((Get-Item -LiteralPath $base -Force).PSIsContainer) { Get-ChildItem -LiteralPath $base -Recurse -Force })\r\n";
        cmd += "  foreach ($item in $items) {\r\n";
        cmd += "    if ($item.FullName.Length -le $root.Length) { continue }\r\n";
        cmd += "    $relative = Get-Relative $item\r\n";
        cmd += `    if ($relative -notmatch ${psQuote(pattern)}) { continue }\r\n`;
        cmd += "    if ($item.PSIsContainer) { Get-ChildItem -LiteralPath $item.FullName -Recurse -Force -File | ForEach-Object { [void]$selected.Add((Get-Relative $_)) } } else { [void]$selected.Add($relative) }\r\n";
        cmd += "  }\r\n";
        cmd += "}\r\n";
    }
    cmd += "foreach ($relative in $selected) {\r\n";
    cmd += "  if (Test-Excluded $relative) { continue }\r\n";
    cmd += "  $target = Join-Path $destination $relative.Replace('/', '\\')\r\n";
    cmd += "  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null\r\n";
    cmd += "  Copy-Item -LiteralPath (Join-Path $root $relative.Replace('/', '\\')) -Destination $target -Force\r\n";
    cmd += "}\r\n";
    cmd += "exit 0\r\n";
    return cmd;
}

/** Parses --container-host values ("os=host"): the engine each container OS runs on, whatever the default engine is. */
export function parseContainerHosts (values: string[]): {[os: string]: string} {
    const result: {[os: string]: string} = {};
    for (const value of values) {
        const at = value.indexOf("=");
        if (at > 0 && at < value.length - 1) result[value.slice(0, at).toLowerCase()] = value.slice(at + 1);
    }
    return result;
}

/**
 * The command line that reaches the engine for a job's containers: the executable alone, or with --host when
 * --container-host names an engine for the job's OS (Docker Desktop runs its Linux and Windows engines side by side,
 * each on its own endpoint, so a pipeline can use both at once).
 */
export function containerCommand (executable: string, hosts: {[os: string]: string}, windows: boolean): string[] {
    const host = hosts[windows ? "windows" : "linux"];
    return host ? [executable, "--host", host] : [executable];
}

const engineOs = new Map<string, Promise<string>>();
/** The OS of the containers an engine runs ("linux" or "windows"), checked once per run and engine. */
export function containerEngineOs (command: string[]): Promise<string> {
    const key = command.join(" ");
    if (!engineOs.has(key)) {
        engineOs.set(key, Shell.spawn([...command, "info", "--format", "{{.OSType}}"]).then(({stdout}) => stdout.trim().toLowerCase()).catch(() => ""));
    }
    return engineOs.get(key)!;
}

export function engineMismatch (windowsJob: boolean, os: string): string | null {
    if (!os) return null;
    if (windowsJob && os !== "windows") return "needs Windows containers, but Docker is running Linux containers. Switch Docker Desktop to Windows containers (tray icon > Switch to Windows containers...) and run it again.";
    if (!windowsJob && os === "windows") return "needs Linux containers, but Docker is running Windows containers. Switch Docker Desktop to Linux containers and run it again; a job runs in a Windows container when its tags mention windows or its image is a Windows image.";
    return null;
}
