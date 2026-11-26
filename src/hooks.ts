import path from "node:path";
import {pathToFileURL} from "node:url";

/** The URL a hook option names: a URL as it is (a scheme of two letters or more, so not a drive), else a path. */
export function hookUrl (specifier: string): string {
    return /^[a-z][a-z\d+.-]+:/i.test(specifier) ? specifier : pathToFileURL(path.resolve(specifier)).href;
}

const modules = new Map<string, Promise<any>>();

/** Loads the module a hook option (--container-hook, --shell-isolation-hook) names, once per process. */
export function loadHook (specifier: string): Promise<any> {
    const url = hookUrl(specifier);
    let module = modules.get(url);
    if (!module) {
        module = import(url);
        modules.set(url, module);
    }
    return module;
}
