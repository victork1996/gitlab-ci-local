import {WriteStreamsMock} from "../../../src/write-streams.js";
import {handler} from "../../../src/handler.js";
import * as yaml from "js-yaml";
import {initSpawnSpy} from "../../mocks/utils.mock.js";
import {WhenStatics} from "../../mocks/when-statics.js";
import {rubyFloatToS, tokenize} from "../../../src/yaml-psych.js";

beforeAll(() => {
    initSpawnSpy(WhenStatics.all);
});

test.concurrent("yaml-psych-scalars variables match GitLab's Psych and Ruby .to_s", async () => {
    const writeStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/yaml-psych-scalars",
        listJson: true,
        stateDir: ".gitlab-ci-local-yaml-psych-scalars",
    }, writeStreams);

    const jobs = JSON.parse(writeStreams.stdoutLines.join("\n"));
    expect(jobs.map((job: {name: string}) => job.name)).toEqual(["job 1/2", "job 2/2"]);

    const previewStreams = new WriteStreamsMock();
    await handler({
        cwd: "tests/test-cases/yaml-psych-scalars",
        preview: true,
        stateDir: ".gitlab-ci-local-yaml-psych-scalars-preview",
    }, previewStreams);
    const preview = yaml.load(previewStreams.stdoutLines.join("\n")) as any;
    expect(preview.variables).toEqual({GLOBAL_ON: "true"});
    expect(preview.job.retry).toBe(1);
    expect(preview.job.variables).toEqual({
        YES_UPPER: "true",
        OFF_MIXED: "false",
        Y_LETTER: "y",
        N_LETTER: "n",
        OCTAL: "493",
        HEX: "31",
        BINARY: "5",
        SEXAGESIMAL: "5400",
        COMMAS: "1000",
        NOT_OCTAL: "08",
        FLOAT_ONE: "1.0",
        FLOAT_TRAILING_ZERO: "1.5",
        FLOAT_VERSION: "3.1",
        FLOAT_EXPONENT: "1500.0",
        NOT_A_FLOAT: "1e3",
        QUOTED_ON: "on",
        QUOTED_FLOAT: "1.0",
        NULL_VALUE: "",
    });
});

test.concurrent("yaml-psych-scalars rejects a plain date like GitLab", async () => {
    const writeStreams = new WriteStreamsMock();
    await expect(handler({
        cwd: "tests/test-cases/yaml-psych-scalars",
        file: ".gitlab-ci-date.yml",
        listJson: true,
        stateDir: ".gitlab-ci-local-yaml-psych-scalars-date",
    }, writeStreams)).rejects.toThrow("Tried to load unspecified class: Date");
});

test("yaml-psych tokenize", () => {
    expect(tokenize("yEs")).toEqual({kind: "bool", value: true});
    expect(tokenize("ON")).toEqual({kind: "bool", value: true});
    expect(tokenize("y")).toEqual({kind: "str"});
    expect(tokenize("-0x1F")).toEqual({kind: "int", value: -31});
    expect(tokenize("1:30:15")).toEqual({kind: "int", value: 5415});
    expect(tokenize(".5")).toEqual({kind: "float", value: 0.5});
    expect(tokenize("1.")).toEqual({kind: "float", value: 1});
    expect(tokenize(":sym")).toEqual({kind: "str"});
    expect(() => tokenize("2024-01-01 10:00:00")).toThrow("Tried to load unspecified class: Time");
});

test("yaml-psych rubyFloatToS", () => {
    expect(rubyFloatToS(1)).toBe("1.0");
    expect(rubyFloatToS(1000)).toBe("1000.0");
    expect(rubyFloatToS(0.0001)).toBe("0.0001");
    expect(rubyFloatToS(1e-5)).toBe("1.0e-05");
    expect(rubyFloatToS(1e16)).toBe("1.0e+16");
    expect(rubyFloatToS(-2.5e-7)).toBe("-2.5e-07");
    expect(rubyFloatToS(Infinity)).toBe("Infinity");
});
