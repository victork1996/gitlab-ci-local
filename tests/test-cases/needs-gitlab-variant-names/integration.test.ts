import {WriteStreamsMock} from "../../../src/write-streams.js";
import {handler} from "../../../src/handler.js";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});

test.concurrent("needs-gitlab-variant-names --list-json", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/needs-gitlab-variant-names",
        listJson: true,
        stateDir: ".gitlab-ci-local-needs-gitlab-variant-names",
    }, writeStreams);

    const jobs = JSON.parse(writeStreams.stdoutLines.join("\n"));
    const check = jobs.find((job: {name: string}) => job.name === "check");
    expect(check.needs.map((need: {job: string}) => need.job)).toEqual(["build: [linux, amd64]", "shard 2/2"]);
    expect(jobs.map((job: {name: string}) => job.name)).toEqual(expect.arrayContaining(["build: [linux,amd64]", "shard: [2/2]"]));
});
