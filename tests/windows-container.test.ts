import {execFileSync} from "node:child_process";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import {
    POWERSHELL, UTF8_BOM, containerCommand, copyMatchesCommand, engineMismatch, isWindowsContainerJob, isWindowsImage, parseContainerHosts, parseImageOs, powershellJobScript, psQuote, robocopyCommand, windowsProjectDir,
} from "../src/windows-container.js";

describe("Windows container jobs", () => {
    test.each([
        "mcr.microsoft.com/windows/servercore:ltsc2022",
        "mcr.microsoft.com/windows/nanoserver:ltsc2022",
        "mcr.microsoft.com/windows:ltsc2019",
        "mcr.microsoft.com/windows/server:ltsc2022",
        "mcr.microsoft.com/dotnet/framework/sdk:4.8.1",
        "mcr.microsoft.com/powershell:lts-windowsservercore-ltsc2022",
        "registry.example.com/team/windows/build:1",
    ])("recognizes the Windows image %s", (image) => {
        expect(isWindowsImage(image)).toBe(true);
    });

    test.each([
        "docker.io/ruby:3.1", "node:24-bookworm", "mcr.microsoft.com/dotnet/sdk:8.0", "registry.example.com/windowsfoo:1", "alpine",
    ])("treats %s as a Linux image", (image) => {
        expect(isWindowsImage(image)).toBe(false);
    });

    test("an image's known OS overrides its name, but not windows tags", () => {
        const imageOs = parseImageOs(["registry.example.com/team/builder:1=windows", "mcr.microsoft.com/windows/servercore:ltsc2022=linux", "host:5000/app=LINUX"]);
        expect(imageOs).toEqual({"registry.example.com/team/builder:1": "windows", "mcr.microsoft.com/windows/servercore:ltsc2022": "linux", "host:5000/app": "linux"});
        expect(isWindowsContainerJob("registry.example.com/team/builder:1", [], imageOs)).toBe(true);
        expect(isWindowsContainerJob("mcr.microsoft.com/windows/servercore:ltsc2022", [], imageOs)).toBe(false);
        expect(isWindowsContainerJob("host:5000/app", ["windows"], imageOs)).toBe(true);
        expect(isWindowsContainerJob("other/image:1", [], imageOs)).toBe(false);
    });

    test("--container-host sends each container OS to its own engine", () => {
        const hosts = parseContainerHosts(["linux=npipe:////./pipe/dockerDesktopLinuxEngine", "WINDOWS=npipe:////./pipe/docker_engine_windows", "bad", "mac="]);
        expect(hosts).toEqual({linux: "npipe:////./pipe/dockerDesktopLinuxEngine", windows: "npipe:////./pipe/docker_engine_windows"});
        expect(containerCommand("docker", hosts, true)).toEqual(["docker", "--host", "npipe:////./pipe/docker_engine_windows"]);
        expect(containerCommand("docker", hosts, false)).toEqual(["docker", "--host", "npipe:////./pipe/dockerDesktopLinuxEngine"]);
        expect(containerCommand("docker", {windows: "unix:///Case/Sensitive.sock"}, false)).toEqual(["docker"]);
        expect(parseContainerHosts(["linux=unix:///Case/Sensitive.sock"]).linux).toBe("unix:///Case/Sensitive.sock");
    });

    test("tags mentioning windows select a Windows container, but only for jobs with an image", () => {
        expect(isWindowsContainerJob("my/builder:1", ["saas-windows-medium-amd64"])).toBe(true);
        expect(isWindowsContainerJob("my/builder:1", ["Windows"])).toBe(true);
        expect(isWindowsContainerJob("my/builder:1", ["docker", "linux"])).toBe(false);
        expect(isWindowsContainerJob("my/builder:1", undefined)).toBe(false);
        expect(isWindowsContainerJob(null, ["windows"])).toBe(false);
        expect(isWindowsContainerJob("mcr.microsoft.com/windows/servercore:ltsc2022", [])).toBe(true);
    });

    test("projects live under C:\\builds, like GitLab's Windows runners", () => {
        expect(windowsProjectDir("group/sub", "app")).toBe("C:\\builds\\group\\sub\\app");
    });

    test("a job on the wrong Docker engine is explained before it starts", () => {
        expect(engineMismatch(true, "linux")).toMatch(/Switch Docker Desktop to Windows containers/);
        expect(engineMismatch(false, "windows")).toMatch(/Switch Docker Desktop to Linux containers/);
        expect(engineMismatch(true, "windows")).toBeNull();
        expect(engineMismatch(false, "linux")).toBeNull();
        expect(engineMismatch(true, "")).toBeNull();
    });

    test("PowerShell literals double their quotes", () => {
        expect(psQuote("it's")).toBe("'it''s'");
        expect(robocopyCommand("C:\\in", "C:\\out")).toContain("robocopy 'C:\\in' 'C:\\out' /E");
    });
});

// The generated scripts run here with the local Windows PowerShell, as they would in a container.
describe.runIf(process.platform === "win32")("generated PowerShell", () => {
    let dir: string;
    beforeEach(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), "gcl-windows-"));
    });
    afterEach(async () => {
        await fs.rm(dir, {recursive: true, force: true});
    });

    const run = (script: string) => {
        const file = path.join(dir, "script.ps1");
        fs.writeFileSync(file, UTF8_BOM + script, "utf-8");
        try {
            return {code: 0, stdout: execFileSync(POWERSHELL[0], [...POWERSHELL.slice(1), "-File", file], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]})};
        } catch (error: any) {
            return {code: error.status as number, stdout: String(error.stdout)};
        }
    };

    test("echoes each command, runs it in the project directory, and stops at the first failure", () => {
        const result = run(powershellJobScript([
            "Write-Output \"in $(Split-Path -Leaf (Get-Location))\"",
            "cmd /c exit 3",
            "Write-Output never",
        ], {projectDir: dir, promptPlaceholder: "<prompt>"}));
        expect(result.code).toBe(3);
        expect(result.stdout).toContain("<prompt> Write-Output \"in $(Split-Path -Leaf (Get-Location))\"");
        expect(result.stdout).toContain(`in ${path.basename(dir)}`);
        expect(result.stdout).toContain("<prompt> cmd /c exit 3");
        expect(result.stdout).not.toContain("never");
    });

    test("a failing cmdlet fails the job with exit code 1, and success exits 0", () => {
        expect(run(powershellJobScript(["Get-Item C:\\does-not-exist-gcl"], {projectDir: dir, promptPlaceholder: "<p>"})).code).toBe(1);
        expect(run(powershellJobScript(["Write-Output ok"], {projectDir: dir, promptPlaceholder: "<p>"})).code).toBe(0);
    });

    test("after_script sees the job status, and non-ASCII output survives", () => {
        const result = run(powershellJobScript(["Write-Output \"status=$env:CI_JOB_STATUS ünïcode\""], {projectDir: dir, promptPlaceholder: "<p>", jobStatus: "failed"}));
        expect(result.stdout).toContain("status=failed ünïcode");
    });

    test("multi-line commands are echoed once, collapsed", () => {
        const result = run(powershellJobScript(["$a = 1\nWrite-Output \"a=$a\""], {projectDir: dir, promptPlaceholder: "<p>"}));
        expect(result.stdout).toContain("<p> $a = 1 # collapsed multi-line command");
        expect(result.stdout).toContain("a=1");
    });

    test("artifacts and cache paths are matched like GitLab's globs", async () => {
        const project = path.join(dir, "project"), out = path.join(dir, "out");
        for (const file of ["dist/app.exe", "dist/sub/lib.dll", "dist/skip.pdb", "logs/a.log", "logs/deep/b.log", "src/main.cs", "README.md", ".hidden/x", ".gitlab-ci-local/state"]) {
            await fs.outputFile(path.join(project, file), file);
        }
        const result = run(copyMatchesCommand({
            patterns: ["dist", "**/*.log", `${project}\\README.md`, ".hidden/"],
            exclude: ["**/*.pdb"],
            destination: out, projectDir: project, stateDir: ".gitlab-ci-local",
        }));
        expect(result.code).toBe(0);
        const copied = (await fs.readdir(out, {recursive: true, withFileTypes: true})).filter((e) => e.isFile()).map((e) => path.relative(out, path.join(e.parentPath, e.name)).replaceAll("\\", "/")).sort();
        expect(copied).toEqual([".hidden/x", "README.md", "dist/app.exe", "dist/sub/lib.dll", "logs/a.log", "logs/deep/b.log"]);
    });
});
