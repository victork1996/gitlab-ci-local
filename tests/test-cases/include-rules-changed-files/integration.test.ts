import {WriteStreamsMock} from "../../../src/write-streams.js";
import {handler} from "../../../src/handler.js";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});

async function jobNames (args: {[key: string]: unknown}) {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/include-rules-changed-files",
        listJson: true,
        ...args,
    }, writeStreams);
    return JSON.parse(writeStreams.stdoutLines.join("\n"))
        .filter((job: {when: string}) => job.when !== "never")
        .map((job: {name: string}) => job.name)
        .sort();
}

test.concurrent("include-rules-changed-files --rule-changed-files evaluates include and job rules:changes", async () => {
    const names = await jobNames({
        ruleChangedFiles: "changed-files.txt",
        evaluateRuleChanges: false,
        stateDir: ".gitlab-ci-local-include-rules-changed-files",
    });
    expect(names).toEqual(["always-job", "changed-job", "src-job"]);
});

test.concurrent("include-rules-changed-files --no-evaluate-rule-changes passes every changes clause", async () => {
    const names = await jobNames({
        evaluateRuleChanges: false,
        stateDir: ".gitlab-ci-local-include-rules-changed-files-off",
    });
    expect(names).toEqual(["always-job", "changed-job", "docs-job", "src-job", "unchanged-job"]);
});
