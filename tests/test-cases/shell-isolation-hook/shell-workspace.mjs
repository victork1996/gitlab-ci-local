import fs from "node:fs";

// Prepares a job folder as a private overlay would: a new, empty one each time. Each call is noted in the state dir.
export async function prepareShellWorkspace (cwd, stateDir, jobFolder) {
    const folder = `${cwd}/${stateDir}/builds/${jobFolder}`;
    fs.rmSync(folder, {recursive: true, force: true});
    fs.mkdirSync(folder, {recursive: true});
    fs.appendFileSync(`${cwd}/${stateDir}/workspace-calls`, `${jobFolder}\n`);
}
