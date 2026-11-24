import {WriteStreamsMock} from "../../../src/write-streams.js";
import {handler} from "../../../src/handler.js";
import chalk from "chalk-template";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});

test.concurrent("manual --manual <build-job> --manual <pre-job>", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/manual/",
        manual: ["build-job", "pre-job"],
        stateDir: ".gitlab-ci-local-manual-manual-build-job-manual-pre-job",
    }, writeStreams);

    const expected = [
        chalk`{blueBright pre-job   } {greenBright >} im a rules variable`,
        chalk`{blueBright pre-job   } {greenBright >} Hello, pre job manual!`,
        chalk`{blueBright build-job } {greenBright >} Hello, build job manual!`,
    ];
    expect(writeStreams.stdoutLines).toEqual(expect.arrayContaining(expected));
});

test.concurrent("manual --manual <build-job> --manual <build-job> --manual <pre-job>", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/manual/",
        manual: ["build-job", "build-job", "pre-job"],
        stateDir: ".gitlab-ci-local-manual-manual-build-job-manual-build-job-manual-pr",
    }, writeStreams);

    const filter = writeStreams.stdoutLines.filter(l => {
        return l.match(/Hello, build job manual!/) !== null;
    });
    expect(filter.length).toBe(2);
});

test.concurrent("manual <deploy-job>", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/manual/",
        job: ["deploy-job"],
        stateDir: ".gitlab-ci-local-manual-deploy-job",
    }, writeStreams);

    const foundBuildText = writeStreams.stdoutLines.find((l) => {
        return l.match(/Hello, build job manual!/) !== null;
    });
    expect(foundBuildText).toEqual(undefined);

    const foundTestText = writeStreams.stdoutLines.find((l) => {
        return l.match(/Test something/) !== null;
    });
    expect(foundTestText).toEqual(undefined);

    const expected = [
        chalk`{blueBright deploy-job} {greenBright >} Deploy something`,
    ];
    expect(writeStreams.stdoutLines).toEqual(expect.arrayContaining(expected));
});

test.concurrent("manual <deploy-job> --needs is blocked by unplayed manual jobs", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/manual/",
        job: ["deploy-job"],
        needs: true,
        stateDir: ".gitlab-ci-local-manual-deploy-job-needs",
    }, writeStreams);

    // pre-job and build-job get `manual` from a rule, so allow_failure is false and they block later stages
    for (const text of [/Hello, pre job manual!/, /Hello, build job manual!/, /Test something/, /Deploy something/]) {
        expect(writeStreams.stdoutLines.find(l => l.match(text) !== null)).toEqual(undefined);
    }
});

test.concurrent("manual <build-job>", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/manual/",
        job: ["build-job"],
        stateDir: ".gitlab-ci-local-manual-build-job",
    }, writeStreams);

    const expected = [
        chalk`{blueBright build-job} {greenBright >} Hello, build job manual!`,
    ];
    expect(writeStreams.stdoutLines).toEqual(expect.arrayContaining(expected));
});

test.concurrent("manual <test-job> --needs --manual <pre-job>", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/manual/",
        job: ["test-job"],
        needs: true,
        manual: "pre-job",
        stateDir: ".gitlab-ci-local-manual-test-job-needs-manual-pre-job",
    }, writeStreams);

    const expected = [
        chalk`{blueBright pre-job } {greenBright >} Hello, pre job manual!`,
        chalk`{blueBright test-job} {greenBright >} Test something`,
    ];
    expect(writeStreams.stdoutLines).toEqual(expect.arrayContaining(expected));
});

test.concurrent("manual --manual <pre-job>", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/manual/",
        manual: "pre-job",
        stateDir: ".gitlab-ci-local-manual-manual-pre-job",
    }, writeStreams);

    const expected = [
        chalk`{blueBright pre-job   } {greenBright >} Hello, pre job manual!`,
        chalk`{blueBright test-job  } {greenBright >} Test something`,
    ];
    expect(writeStreams.stdoutLines).toEqual(expect.arrayContaining(expected));
    // build-job is an unplayed blocking manual job, so the stage-ordered deploy-job never runs
    expect(writeStreams.stdoutLines.find(l => l.match(/Deploy something/) !== null)).toEqual(undefined);
});

test.concurrent("manual", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/manual/",
        stateDir: ".gitlab-ci-local-manual",
    }, writeStreams);

    // pre-job blocks test-job (needs) and deploy-job (later stage); nothing runs and nothing throws
    for (const text of [/Hello, pre job manual!/, /Hello, build job manual!/, /Test something/, /Deploy something/]) {
        expect(writeStreams.stdoutLines.find(l => l.match(text) !== null)).toEqual(undefined);
    }
});
