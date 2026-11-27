import {WriteStreamsMock} from "../../../src/write-streams.js";
import {handler} from "../../../src/handler.js";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});

test("needs-start-early: a job starts once its needs finish, not once its wave does", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/needs-start-early",
        stateDir: ".gitlab-ci-local-needs-start-early",
    }, writeStreams);

    const lineOf = (text: string) => writeStreams.stdoutLines.findIndex((line) => line.includes(text));
    expect(lineOf("next done")).toBeGreaterThan(-1);
    expect(lineOf("slow done")).toBeGreaterThan(-1);
    expect(lineOf("next done")).toBeLessThan(lineOf("slow done"));
});
