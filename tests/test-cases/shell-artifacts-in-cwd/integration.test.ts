import {WriteStreamsMock} from "../../../src/write-streams.js";
import {handler} from "../../../src/handler.js";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";
import chalk from "chalk-template";
import fs from "fs-extra";

// produce's artifacts are in the state dir only, as when it ran with --artifacts-to-source=false.
// The tests run one after another: both would write out/ in the test case's folder.
const cwd = "tests/test-cases/shell-artifacts-in-cwd";

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});

afterEach(async () => {
    await fs.remove(`${cwd}/out`);
    await fs.remove(`${cwd}/.gitlab-ci-reports`);
});

async function consume (stateDir: string, options: {[key: string]: unknown}) {
    await fs.remove(`${cwd}/${stateDir}`);
    await fs.outputFile(`${cwd}/${stateDir}/artifacts/produce/out/file.txt`, "restored\n");
    await fs.outputFile(`${cwd}/${stateDir}/artifacts/produce/.gitlab-ci-reports/report.json`, "{}");
    const writeStreams = new WriteStreamsMock();
    await handler({cwd, job: ["consume"], artifactsToSource: false, stateDir, ...options}, writeStreams);
    return writeStreams;
}

test("shell-artifacts-in-cwd <consume> --shell-artifacts-in-cwd --preparation-steps", async () => {
    const writeStreams = await consume(".gitlab-ci-local-shell-artifacts-in-cwd", {shellArtifactsInCwd: true, preparationSteps: true});

    expect(writeStreams.stdoutLines).toEqual(expect.arrayContaining([
        chalk`{blueBright consume} {magentaBright importing artifacts}`,
        chalk`{blueBright consume} {greenBright >} restored`,
    ]));
    expect(await fs.pathExists(`${cwd}/.gitlab-ci-reports`)).toBe(false);
});

test("shell-artifacts-in-cwd <consume>", async () => {
    await consume(".gitlab-ci-local-shell-artifacts-in-cwd-off", {});

    expect(await fs.pathExists(`${cwd}/out/file.txt`)).toBe(false);
});
