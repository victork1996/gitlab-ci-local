import {WriteStreamsMock} from "../../../src/write-streams.js";
import {handler} from "../../../src/handler.js";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});

// eslint-disable-next-line no-control-regex
const ran = (writeStreams: WriteStreamsMock, name: string) => writeStreams.stdoutLines.some(l => l.replaceAll(/\x1b\[[\d;]*m/g, "").endsWith(`> ${name} ran`));

// GitLab: an unplayed job-level manual job defaults to allow_failure true and counts as skipped for followers
test.concurrent("manual-optional", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/manual-optional/",
        stateDir: ".gitlab-ci-local-manual-optional",
    }, writeStreams);

    expect(ran(writeStreams, "manual-opt")).toBe(false);
    expect(ran(writeStreams, "manual-opt-rules")).toBe(false);
    expect(ran(writeStreams, "stage-follower")).toBe(true);
    expect(ran(writeStreams, "dag-success")).toBe(false);
    expect(ran(writeStreams, "dag-always")).toBe(true);
});

test.concurrent("manual-optional --list-json allow_failure defaults", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/manual-optional/",
        listJson: true,
        stateDir: ".gitlab-ci-local-manual-optional-list",
    }, writeStreams);

    const jobs = JSON.parse(writeStreams.stdoutLines.join("\n"));
    const allowFailure = Object.fromEntries(jobs.map((j: {name: string; allow_failure: boolean}) => [j.name, j.allow_failure]));
    expect(allowFailure["manual-opt"]).toBe(true);
    expect(allowFailure["manual-opt-rules"]).toBe(true);
    expect(allowFailure["stage-follower"]).toBe(false);
});
