import {WriteStreamsMock} from "../../../src/write-streams.js";
import {handler} from "../../../src/handler.js";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});

// eslint-disable-next-line no-control-regex
const ran = (writeStreams: WriteStreamsMock, name: string) => writeStreams.stdoutLines.some(l => l.replaceAll(/\x1b\[[\d;]*m/g, "").endsWith(`> ${name} ran`));

// GitLab: an unplayed manual job with allow_failure false blocks its followers, the rest still runs
test.concurrent("manual-blocking", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/manual-blocking/",
        stateDir: ".gitlab-ci-local-manual-blocking",
    }, writeStreams);

    expect(ran(writeStreams, "build-ok")).toBe(true);
    expect(ran(writeStreams, "needs-ok")).toBe(true);
    expect(ran(writeStreams, "manual-block")).toBe(false);
    expect(ran(writeStreams, "rule-manual")).toBe(false);
    expect(ran(writeStreams, "stage-follower")).toBe(false);
    expect(ran(writeStreams, "needs-block")).toBe(false);
    expect(ran(writeStreams, "needs-rule-manual")).toBe(false);
});

test.concurrent("manual-blocking --manual manual-block --manual rule-manual", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/manual-blocking/",
        manual: ["manual-block", "rule-manual"],
        stateDir: ".gitlab-ci-local-manual-blocking-played",
    }, writeStreams);

    for (const name of ["build-ok", "needs-ok", "manual-block", "rule-manual", "stage-follower", "needs-block", "needs-rule-manual"]) {
        expect(ran(writeStreams, name)).toBe(true);
    }
});
