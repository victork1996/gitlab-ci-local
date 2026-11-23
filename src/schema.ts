import schema from "./schema.json";

// Remove patterns that are too strict for gitlab-ci-local usage
delete schema.definitions.include_item.oneOf[0].pattern; // include shorthand rejects glob wildcards
delete schema.definitions.cache_item.properties.key.oneOf[0].pattern; // cache key rejects paths with /
// @ts-expect-error ts-expect-error
delete schema.definitions.job_template.properties.environment.oneOf[1].properties.name.minLength; // environment name rejects unexpanded variables
// @ts-expect-error ts-expect-error
delete schema.definitions.job_template.properties.environment.oneOf[1].properties.url.pattern; // environment url rejects variables with underscores
// @ts-expect-error ts-expect-error
delete schema.definitions.job_template.properties.trigger.oneOf[1].properties.include.oneOf[1].items.oneOf[2].properties.artifact.pattern; // trigger artifact rejects a variable such as $CHILD_PIPELINE_YML
// GitLab accepts `parallel: null`, which clears a value inherited through extends or anchors
// @ts-expect-error ts-expect-error
schema.definitions.parallel.oneOf.push({"type": "null"});

// @ts-expect-error ts-expect-error
schema.definitions.job_template.properties.gclInjectSSHAgent = {
    "type": "boolean",
};
// @ts-expect-error ts-expect-error
schema.definitions.job_template.properties.gclInteractive = {
    "type": "boolean",
};
// @ts-expect-error ts-expect-error
schema.definitions.job_template.properties.gclArtifactsToSource = {
    "type": "boolean",
};
// @ts-expect-error ts-expect-error
schema.definitions.job_template.properties.gclDescription = {
    "type": "string",
};

export default schema;
