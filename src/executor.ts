import chalk from "chalk-template";
import {Job} from "./job.js";
import assert from "node:assert";
import {Argv} from "./argv.js";
import {isJobReference, matrixSelectorMatches} from "./parallel.js";

/** Where a job stands: finished with a result, not run (skipped), waiting to be played (manual), able to start (ready), or not decided yet (waiting). */
type JobState = "success" | "warning" | "failed" | "skipped" | "manual" | "ready" | "waiting";
type CompositeKey = "success" | "warning" | "failed" | "skipped" | "manual" | "ignored" | "waiting";

export class Executor {

    /**
     * Runs every job that can start, up to --concurrency at once. Each time a job finishes, the jobs it unblocks
     * start at once, as on GitLab: a job never waits for unrelated jobs that started alongside the ones it needs.
     * `manuals` lists the manual jobs that count as played (defaults to --manual).
     */
    static async runLoop (argv: Argv, jobs: ReadonlyArray<Job>, stages: readonly string[], potentialStarters: Job[], manuals: string[] = argv.manual): Promise<void> {
        const limit = argv.concurrency ?? Infinity;
        // A trigger job counts as started only once it has done its work, so launched jobs are kept here too.
        const launched = new Set<Job>();
        // Jobs whose start() has not returned. A job reports itself finished once its scripts end, before it copies
        // its cache and artifacts out, so the jobs that need it wait for start() instead.
        const inFlight = new Set<Job>();
        const running = new Set<Promise<void>>();
        let failure: {error: unknown} | null = null;
        for (;;) {
            for (const job of Executor.getStartCandidates(jobs, stages, potentialStarters, manuals, inFlight)) {
                if (running.size >= limit) break;
                if (launched.has(job)) continue;
                launched.add(job);
                inFlight.add(job);
                const run: Promise<void> = job.start()
                    .catch((error: unknown) => {
                        failure ??= {error};
                    })
                    .finally(() => {
                        inFlight.delete(job);
                        running.delete(run);
                    });
                running.add(run);
            }
            if (running.size === 0) return;
            await Promise.race(running);
            // As before, the first job that cannot run stops the pipeline; jobs already running carry on.
            if (failure) throw (failure as {error: unknown}).error;
        }
    }

    /** `inFlight`: jobs still running, whatever they report (see runLoop). */
    static getStartCandidates (jobs: ReadonlyArray<Job>, stages: readonly string[], potentialStarters: readonly Job[], manuals: string[], inFlight: ReadonlySet<Job> = new Set()) {
        const states = new Map<Job, JobState>([...inFlight].map((job) => [job, "waiting"]));
        const startCandidates = [];
        for (const job of [...new Set<Job>(potentialStarters)]) {
            if (job.started) continue;
            if (Executor.getJobState(jobs, stages, job, manuals, states) === "ready") {
                startCandidates.push(job);
            }
        }
        return startCandidates;
    }

    /**
     * Mirrors GitLab's atomic processing: a job's state comes from the composite status of the jobs
     * it depends on (its direct needs, or every job of earlier stages) and its own `when`.
     */
    static getJobState (jobs: ReadonlyArray<Job>, stages: readonly string[], job: Job, manuals: string[], states: Map<Job, JobState>): JobState {
        const known = states.get(job);
        if (known) return known;
        if (job.finished) return job.jobStatus === "failed" ? "failed" : job.jobStatus === "warning" ? "warning" : "success";
        if (job.started) return "waiting";

        states.set(job, "waiting"); // Guards against needs cycles
        const dag = job.needs != null;
        const deps = dag ? Executor.getNeededToWaitFor(jobs, job) : Executor.getPreviousToWaitFor(jobs, stages, job).filter(j => j.when !== "never");
        const previous = Executor.compositeStatus(deps.map(d => Executor.compositeKey(d, Executor.getJobState(jobs, stages, d, manuals, states))), dag);

        let state: JobState;
        if (previous === "waiting" || previous === "manual") {
            // Not complete yet, or blocked by a manual job that must be played first
            state = "waiting";
        } else if (Executor.validPreviousStatuses(job.when, dag).includes(previous)) {
            state = job.when === "manual" && !manuals.includes(job.name) ? "manual" : "ready";
        } else {
            state = "skipped";
        }
        states.set(job, state);
        return state;
    }

    static compositeKey (job: Job, state: JobState): CompositeKey {
        if (state === "manual") return job.allowFailure === true ? "ignored" : "manual";
        if (state === "ready") return "waiting";
        return state;
    }

    /** Port of lib/gitlab/ci/status/composite.rb, limited to the statuses gitlab-ci-local produces. */
    static compositeStatus (keys: CompositeKey[], dag: boolean): "success" | "failed" | "skipped" | "waiting" | "manual" {
        const set = new Set(keys);
        const onlyOf = (...names: CompositeKey[]) => set.size > 0 && [...set].every(k => names.includes(k));
        if (set.size === 0) return "success";
        if (dag && (set.has("skipped") || set.has("ignored"))) return "skipped";
        if (onlyOf("skipped", "ignored")) return "skipped";
        if (onlyOf("success", "skipped", "warning", "ignored")) return "success";
        if (set.has("waiting")) return "waiting";
        if (set.has("manual")) return "manual";
        return "failed";
    }

    /** Port of Ci::ProcessBuildService#valid_statuses_for_build. */
    static validPreviousStatuses (when: string, dag: boolean): string[] {
        switch (when) {
            case "on_success":
            case "manual":
            case "delayed":
                return dag ? ["success"] : ["success", "skipped"];
            case "on_failure":
                return ["failed"];
            case "always":
                return ["success", "failed", "skipped"];
            default:
                return [];
        }
    }

    static getFailed (jobs: ReadonlyArray<Job>) {
        return jobs.filter(j => j.finished && !j.allowFailure && (j.preScriptsExitCode ?? 0) > 0);
    }

    static getPastToWaitFor (jobs: ReadonlyArray<Job>, stages: readonly string[], job: Job, manuals: string[]) {
        const jobsToWaitForSet = new Set<Job>();
        let waitForLoopArray: Job[] = [job];

        while (waitForLoopArray.length > 0) {
            const loopJob = waitForLoopArray.pop();
            assert(loopJob != null, "Job not found in getPastToWaitFor, should be impossible!");
            if (loopJob.needs) {
                const neededToWaitFor = this.getNeededToWaitFor(jobs, loopJob);
                waitForLoopArray.push(...neededToWaitFor);
            } else {
                const previousToWaitFor = this.getPreviousToWaitFor(jobs, stages, loopJob);
                waitForLoopArray = waitForLoopArray.concat(previousToWaitFor);
                waitForLoopArray = waitForLoopArray.filter(j => j.when !== "never");
                waitForLoopArray = waitForLoopArray.filter(j => j.when !== "manual" || manuals.includes(j.name));
            }
            waitForLoopArray.forEach(j => jobsToWaitForSet.add(j));
        }
        return [...jobsToWaitForSet];
    }

    static getNeededToWaitFor (jobs: ReadonlyArray<Job>, job: Job) {
        const toWaitFor = [];
        assert(job.needs != null, chalk`${job.name}.needs cannot be null in getNeededToWaitFor`);
        for (const need of job.needs) {
            let baseJobs = jobs.filter(j => isJobReference(j, need.job));
            if (need.parallel?.matrix && baseJobs.length > 0) {
                assert(!baseJobs.every(j => j.matrixVariables == null), chalk`{blueBright ${job.name}} uses needs.parallel.matrix targeting {blueBright ${need.job}}, but {blueBright ${need.job}} has no parallel:matrix configuration`);
                baseJobs = baseJobs.filter(j => matrixSelectorMatches(j.matrixVariables, need.parallel!.matrix));
                assert(baseJobs.length > 0 || need.optional, chalk`{blueBright ${job.name}} needs.parallel.matrix selector for {blueBright ${need.job}} matched zero permutations`);
            }
            for (const j of baseJobs) {
                if (j.when === "never" && need.optional) {
                    continue;
                }
                assert(j.when !== "never", chalk`{blueBright ${j.name}} is when:never, but its needed by {blueBright ${job.name}}`);
                assert(job.name !== j.name, chalk`This GitLab CI configuration is invalid: The pipeline has circular dependencies: self-dependency: {blueBright ${need.job}}.`);
                toWaitFor.push(j);
            }
        }
        return toWaitFor;
    }

    static getPreviousToWaitFor (jobs: ReadonlyArray<Job>, stages: readonly string[], job: Job) {
        const previousToWaitFor: Job[] = [];
        const stageIndex = stages.indexOf(job.stage);
        const pastStages = stages.slice(0, stageIndex);
        pastStages.forEach((pastStage) => {
            previousToWaitFor.push(...[...jobs.values()].filter(j => j.stage === pastStage));
        });
        return previousToWaitFor;
    }
}
