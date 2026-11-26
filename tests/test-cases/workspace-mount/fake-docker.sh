#!/usr/bin/env bash
# Stands in for the container engine for the calls the runner makes through bash (docker create, docker start),
# which --container-hook does not see. The job's script never runs.
if [ "$1" = "create" ]; then
    echo job-container
fi
