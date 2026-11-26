import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {CICDVariable, findEnvMatchedVariables} from "../src/variables-from-files.js";

describe("findEnvMatchedVariables", () => {
    const variables: {[name: string]: CICDVariable} = {
        CONFIG: {type: "file", environments: [{content: "secret", regexp: /.*/, regexpPriority: 0, scopePriority: 0}]},
        PLAIN: {type: "variable", environments: [{content: "value", regexp: /.*/, regexpPriority: 0, scopePriority: 0}]},
    };

    test("writes file variables to the folder it gives as their paths", async () => {
        const folder = path.join(os.tmpdir(), `gcl-file-variables-${randomUUID()}`);
        try {
            expect(findEnvMatchedVariables(variables, folder)).toEqual({CONFIG: `${folder}/CONFIG`, PLAIN: "value"});
            expect(await fs.readFile(`${folder}/CONFIG`, "utf8")).toEqual("secret");
        } finally {
            await fs.remove(folder);
        }
    });

    test("gives the same paths without writing the files when writeFiles is false", async () => {
        const folder = path.join(os.tmpdir(), `gcl-file-variables-${randomUUID()}`);
        expect(findEnvMatchedVariables(variables, folder, undefined, false)).toEqual({CONFIG: `${folder}/CONFIG`, PLAIN: "value"});
        expect(await fs.pathExists(folder)).toBe(false);
    });
});
