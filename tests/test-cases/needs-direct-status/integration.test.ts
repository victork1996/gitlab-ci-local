import {WriteStreamsMock} from "../../../src/write-streams.js";
import {handler} from "../../../src/handler.js";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});

// eslint-disable-next-line no-control-regex
const ran = (writeStreams: WriteStreamsMock, name: string) => writeStreams.stdoutLines.some(l => l.replaceAll(/\x1b\[[\d;]*m/g, "").endsWith(`> ${name} ran`));

// GitLab: a job with needs takes its status only from its direct needs, not from needs of needs
test.concurrent("needs-direct-status", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/needs-direct-status/",
        stateDir: ".gitlab-ci-local-needs-direct-status",
    }, writeStreams);

    expect(ran(writeStreams, "b")).toBe(true); // when: always after failed a
    expect(ran(writeStreams, "c")).toBe(true); // b succeeded; a's failure is not a direct need
    expect(ran(writeStreams, "x")).toBe(false); // skipped, a failed
    expect(ran(writeStreams, "y")).toBe(false); // on_failure, but its need x was skipped
    expect(ran(writeStreams, "z")).toBe(true); // when: always runs after a skipped need
});
