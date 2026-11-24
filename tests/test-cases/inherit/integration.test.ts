import {WriteStreamsMock} from "../../../src/write-streams.js";
import * as yaml from "js-yaml";
import {handler} from "../../../src/handler.js";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});


describe("inherit:variables", () => {
    test("false should disable inheritance of all global variables", async () => {
        const writeStreams = new WriteStreamsMock();
        await handler({
            file: ".gitlab-ci-inherit-variables.yml",
            cwd: "tests/test-cases/inherit",
            noColor: true,
            job: ["job1"],
        }, writeStreams);

        const filteredStdout = writeStreams.stdoutLines.filter(f => f.startsWith("job1 >")).join("\n");
        expect(filteredStdout).toEqual("");
    });

    test("list of specific variables should only inheritance the respective global variables", async () => {
        const writeStreams = new WriteStreamsMock();
        await handler({
            file: ".gitlab-ci-inherit-variables.yml",
            cwd: "tests/test-cases/inherit",
            noColor: true,
            job: ["job2"],
        }, writeStreams);

        const expected = `job2 > GCL_TESTS_VAR1=This is variable 1
job2 > GCL_TESTS_VAR2=This is variable 2`;

        const filteredStdout = writeStreams.stdoutLines.filter(f => f.startsWith("job2 >")).join("\n");
        expect(filteredStdout).toEqual(expected);
    });
});

test.concurrent("inherit:default", async () => {

    const writeStreams = new WriteStreamsMock();
    await handler({
        file: ".gitlab-ci-inherit-default.yml",
        cwd: "tests/test-cases/inherit",
        preview: true,
        stateDir: ".gitlab-ci-local-inherit-default",
    }, writeStreams);

    const expected = `
---
stages:
  - .pre
  - build
  - test
  - deploy
  - .post
inherit-default-true:
  script:
    - echo script
  image:
    name: busybox
  before_script: &ref_0
    - echo default before script
  after_script:
    - echo default after script
inherit-default-false:
  inherit:
    default: false
  script:
    - echo script
inherit-default-before_script_and_image:
  inherit:
    default:
      - image
      - before_script
  script:
    - echo script
  image:
    name: busybox
  before_script: *ref_0
`;

    expect(writeStreams.stdoutLines.join("\n")).toEqual(expected.trim());
});

test.concurrent("inherit:default tags, retry, timeout, interruptible, id_tokens and hooks", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        file: ".gitlab-ci-inherit-default-keywords.yml",
        cwd: "tests/test-cases/inherit",
        preview: true,
        stateDir: ".gitlab-ci-local-inherit-default-keywords",
    }, writeStreams);

    const preview = yaml.load(writeStreams.stdoutLines.join("\n")) as any;
    const inherited = {
        tags: ["docker"],
        retry: 2,
        timeout: "10m",
        interruptible: true,
        id_tokens: {TOKEN: {aud: "https://example.com"}},
        hooks: {pre_get_sources_script: ["echo hook"]},
    };
    expect(preview["inherits-all"]).toMatchObject(inherited);
    expect(preview["overrides-tags"]).toMatchObject({...inherited, tags: ["shell"]});
    for (const keyword of Object.keys(inherited)) {
        expect(preview["inherits-none"][keyword]).toBeUndefined();
    }
    expect(preview["inherits-listed"]).toMatchObject({tags: ["docker"], retry: 2});
    expect(preview["inherits-listed"].timeout).toBeUndefined();
    expect(preview["default"]).toBeUndefined();
});
