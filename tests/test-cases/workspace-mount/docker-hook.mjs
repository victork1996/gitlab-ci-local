// Stands in for the container engine for every call --container-hook receives, and records them.
export async function runDockerCall (args) {
    (globalThis.containerHookCalls ??= []).push(args);
    if (args[0] === "info") return {stdout: "linux", stderr: ""};
    if (args[0] === "create") return {stdout: "helper-container", stderr: ""};
    return {stdout: "", stderr: ""};
}
