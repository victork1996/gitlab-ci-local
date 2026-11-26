import {execa, execaSync} from "execa";
import {loadHook} from "./hooks.js";

export class Shell {
    static bashMulti (scripts: string[], cwd = process.cwd()): Promise<{stdout: string; stderr: string; exitCode?: number}> {
        return execa(scripts.join(" && \\"), {shell: "bash", cwd, env: Shell.bashEnv()});
    }

    static bash (shellScript: string, cwd = process.cwd()): Promise<{stdout: string; stderr: string; exitCode?: number}> {
        return execa(shellScript, {shell: "bash", cwd, env: Shell.bashEnv()});
    }

    private static bashEnv (): NodeJS.ProcessEnv {
        if (process.platform !== "win32") {
            return process.env;
        }
        return {
            ...process.env,
            MSYS_NO_PATHCONV: "1",
            MSYS2_ARG_CONV_EXCL: "*",
        };
    }

    private static containerHook: {executable: string; module: string} | null = null;

    /**
     * Sends spawned calls to the container executable to a --container-hook module's runDockerCall(args, {cwd, run})
     * instead of starting the executable: a wrapper script started for each call can be slow (one started through
     * Electron takes up to a second). run(file, args, {cwd}) starts a process, for the hook to call the real engine.
     */
    static useContainerHook (executable: string, module: string | null) {
        Shell.containerHook = module ? {executable, module} : null;
    }

    static async spawn (cmdArgs: string[], cwd = process.cwd()): Promise<{stdout: string; stderr: string}> {
        const hook = Shell.containerHook;
        if (hook && cmdArgs[0] === hook.executable) {
            const {runDockerCall} = await loadHook(hook.module);
            return runDockerCall(cmdArgs.slice(1), {cwd, run: (file: string, args: string[], options: {cwd?: string}) => execa(file, args, options)});
        }
        return execa(cmdArgs[0], cmdArgs.slice(1), {cwd});
    }

    static syncSpawn (cmdArgs: string[], cwd = process.cwd()): {stdout: string; stderr: string} {
        return execaSync(cmdArgs[0], cmdArgs.slice(1), {cwd});
    }
}

export function safeBashString (s: string) {
    return `'${s.replaceAll("'", "'\"'\"'")}'`;
}
