#!/usr/bin/env bash

cd "$(dirname "$0")"

RESULTS=()

header() {
    printf "\033[1;33m === %s === \033[0m\n" "$1"
}

footer() {
    RESULT=$1
    if [ $RESULT -ne 0 ]; then
        printf "\033[1;31m === FAILED: $1 === \033[0m\n"
    else
        printf "\033[1;32m === OK === \033[0m\n"
    fi
    echo
}

update-server() {
    header "Updating repository..."
    git fetch && git pull
    RESULT=$?
    RESULTS+=($RESULT)
    footer $RESULT
    return $RESULT
}

update-submodules() {
    header "Updating submodules..."
    echo "Resetting submodules..." && \
        git submodule deinit -f . && \
        echo "Retrieving submodules..." && \
        git submodule update --init --recursive --remote
    RESULT=$?
    RESULTS+=($RESULT)
    footer $RESULT
    return $RESULT
}

if [[ -z "$@" ]]; then
    echo "Updating all components..."
    update-server
    update-submodules
fi

for arg in "$@"; do
    case $arg in
        server|vscode|vim)
            update-server
            ;;
        anvil|submodules)
            update-submodules
            ;;
        *)
            echo "Unknown argument: $arg"
            echo
            echo "Updates the current repository to the most up-to-date state."
            echo
            echo "Usage: $0 [server|submodules]"
            echo
            exit 1
    esac
done

