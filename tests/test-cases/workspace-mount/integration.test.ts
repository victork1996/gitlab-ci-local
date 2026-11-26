import {WriteStreamsMock} from "../../../src/write-streams.js";
import {handler} from "../../../src/handler.js";
import {BIND_FILE_VARIABLES_ENV} from "../../../src/job.js";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";
import chalk from "chalk-template";
import fs from "fs-extra";

// The container executable is a script that answers docker create, and every other call goes to
// docker-hook.mjs (--container-hook), which records it. The tests run one after another: they share the record.
const cwd = "tests/test-cases/workspace-mount";
const containerExecutable = "bash fake-docker.sh";
const calls = (): string[][] => (globalThis as any).containerHookCalls ?? [];
const called = (...prefix: string[]) => calls().some(args => prefix.every((arg, index) => args[index] === arg));

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});

beforeEach(() => {
    (globalThis as any).containerHookCalls = [];
    delete process.env[BIND_FILE_VARIABLES_ENV];
});

async function run (stateDir: string, options: {[key: string]: unknown}) {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd,
        job: ["build"],
        containerExecutable,
        containerHook: `${cwd}/docker-hook.mjs`,
        stateDir,
        ...options,
    }, writeStreams);
    return writeStreams;
}

const step = (text: string) => chalk`{blueBright build} {magentaBright ${text}}`;

test("workspace-mount <build> --workspace-mount copy", async () => {
    const writeStreams = await run(".gitlab-ci-local-workspace-mount-copy", {});

    expect(called("info")).toBe(true);
    expect(called("volume", "create")).toBe(true);
    expect(called("create", "--user=0:0")).toBe(true);
    expect(process.env[BIND_FILE_VARIABLES_ENV]).toBeUndefined();
    expect(writeStreams.stdoutLines.some(line => line.startsWith(chalk`{blueBright build} {magentaBright copied to ${containerExecutable} volumes}`))).toBe(true);
    expect(writeStreams.stdoutLines).not.toContain(step("copying checkout"));
    expect(await fs.pathExists(`${cwd}/.gitlab-ci-local-workspace-mount-copy/builds/.docker`)).toBe(true);
});

test("workspace-mount <build> --workspace-mount bind --preparation-steps", async () => {
    const writeStreams = await run(".gitlab-ci-local-workspace-mount-bind", {workspaceMount: "bind", preparationSteps: true, pullPolicy: "always"});

    expect(called("pull", "docker.io/library/alpine:3")).toBe(true);
    expect(called("volume", "create")).toBe(false);
    expect(called("create", "--user=0:0")).toBe(false);
    expect(process.env[BIND_FILE_VARIABLES_ENV]).toBe("1");
    expect(writeStreams.stdoutLines.some(line => line.startsWith(chalk`{blueBright build} {magentaBright prepared job volumes}`))).toBe(true);
    const steps = ["pulling docker.io/library/alpine:3", "preparing volumes", "creating container", "starting container"];
    expect(writeStreams.stdoutLines.filter(line => steps.some(text => line === step(text)))).toEqual(steps.map(step));
});

test("workspace-mount <build> --workspace-mount overlay --preparation-steps", async () => {
    const writeStreams = await run(".gitlab-ci-local-workspace-mount-overlay", {workspaceMount: "overlay", preparationSteps: true});

    expect(called("volume", "create")).toBe(true);
    expect(called("create", "--user=0:0")).toBe(false);
    expect(process.env[BIND_FILE_VARIABLES_ENV]).toBe("1");
    expect(writeStreams.stdoutLines).toEqual(expect.arrayContaining([step("preparing volumes"), step("creating overlay")]));
    expect(await fs.pathExists(`${cwd}/.gitlab-ci-local-workspace-mount-overlay/builds/.docker`)).toBe(false);
});

test("workspace-mount <build> --workspace-mount bind --no-umask", async () => {
    await run(".gitlab-ci-local-workspace-mount-bind-no-umask", {workspaceMount: "bind", umask: false});

    expect(called("volume", "create")).toBe(true);
    expect(called("create", "--user=0:0")).toBe(true);
    expect(process.env[BIND_FILE_VARIABLES_ENV]).toBeUndefined();
});
