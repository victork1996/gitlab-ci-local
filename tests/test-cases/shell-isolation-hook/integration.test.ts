import {WriteStreamsMock} from "../../../src/write-streams.js";
import {handler} from "../../../src/handler.js";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";
import chalk from "chalk-template";
import fs from "fs-extra";

const cwd = "tests/test-cases/shell-isolation-hook";

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});

test.concurrent("shell-isolation-hook <job> --shell-isolation --shell-isolation-hook --preparation-steps", async () => {
    const stateDir = ".gitlab-ci-local-shell-isolation-hook";
    await fs.remove(`${cwd}/${stateDir}`);
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd,
        job: ["job"],
        shellIsolation: true,
        shellIsolationHook: `${cwd}/shell-workspace.mjs`,
        preparationSteps: true,
        stateDir,
    }, writeStreams);

    // Prepared once: the after_script runs in the script's workspace and sees what the script made.
    expect(await fs.readFile(`${cwd}/${stateDir}/workspace-calls`, "utf8")).toEqual("job\n");
    expect(writeStreams.stdoutLines).toEqual(expect.arrayContaining([
        chalk`{blueBright job} {magentaBright creating overlay}`,
        chalk`{blueBright job} {greenBright >} made`,
    ]));
    // The hook took the rsync copy's place.
    expect(await fs.pathExists(`${cwd}/${stateDir}/builds/job/.gitlab-ci.yml`)).toBe(false);
});

test.concurrent("shell-isolation-hook <job> --shell-isolation", async () => {
    const stateDir = ".gitlab-ci-local-shell-isolation-hook-rsync";
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd,
        job: ["job"],
        shellIsolation: true,
        stateDir,
    }, writeStreams);

    expect(await fs.pathExists(`${cwd}/${stateDir}/builds/job/.gitlab-ci.yml`)).toBe(true);
    expect(writeStreams.stdoutLines).not.toContain(chalk`{blueBright job} {magentaBright copying checkout}`);
});
