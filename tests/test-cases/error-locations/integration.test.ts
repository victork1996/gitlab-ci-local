import {WriteStreamsMock} from "../../../src/write-streams.js";
import {handler} from "../../../src/handler.js";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";
import {formatLocation} from "../../../src/source-map.js";

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});

const cwd = "tests/test-cases/error-locations";
const failure = async (name: string): Promise<any> => {
    try {
        await handler({cwd, file: `.gitlab-ci-${name}.yml`, preview: true, noColor: true, stateDir: `.gitlab-ci-local-error-locations-${name}`}, new WriteStreamsMock());
    } catch (e) {
        return e;
    }
    throw new Error(`.gitlab-ci-${name}.yml was expected to fail`);
};

test.concurrent("error-locations: needs a job inherits are located where they are written", async () => {
    const e = await failure("needs");
    expect(e.message).toContain("needs: [missing-job] for test-job could not be found");
    expect(e.location).toEqual({file: "ci/base.yml", line: 4, column: 22, endColumn: 35});
    expect(formatLocation(e.location)).toBe("--> ci/base.yml:4:22-35");
});

test.concurrent("error-locations: an undefined !reference in an included file", async () => {
    const e = await failure("reference");
    expect(e.message).toBe("!reference [.nowhere, script] is undefined");
    expect(e.location).toEqual({file: "ci/scripts.yml", line: 5, column: 7, endColumn: 36});
});

test.concurrent("error-locations: an unknown job in extends, below a decorator comment", async () => {
    const e = await failure("extends");
    expect(e.message).toContain(".unknown is unspecified, used by test-job extends");
    expect(e.location).toEqual({file: ".gitlab-ci-extends.yml", line: 10, column: 7, endColumn: 15});
});

test.concurrent("error-locations: a stage that is not defined", async () => {
    const e = await failure("stage");
    expect(e.location).toEqual({file: ".gitlab-ci-stage.yml", line: 3, column: 10, endColumn: 17});
});

test.concurrent("error-locations: a local include that is not there", async () => {
    const e = await failure("include");
    expect(e.message).toBe("Local include file cannot be found ci/absent.yml");
    expect(e.location).toEqual({file: ".gitlab-ci-include.yml", line: 4, column: 12, endColumn: 25});
});

test.concurrent("error-locations: each schema error says where it is", async () => {
    const e = await failure("schema");
    expect(e.message).toContain("'when' property must be one of");
    expect(e.locations.map(({location, about}: any) => formatLocation(location, about))).toEqual([
        "--> .gitlab-ci-schema.yml:4:9-18 (test-job.when)",
        "--> .gitlab-ci-schema.yml:8:7-21 (test-job.artifacts.reports)",
    ]);
});

test.concurrent("error-locations: a YAML syntax error", async () => {
    const e = await failure("syntax");
    expect(e.location).toMatchObject({file: ".gitlab-ci-syntax.yml", line: 5});
});
