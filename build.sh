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

build-anvil() {
    header "Building Anvil..."

    if [ ! -d "./anvil/lib/" ] || [ ! -d "./anvil/bin/" ]; then
        echo "Anvil submodule not initialized. Initializing now..."
        git submodule update --init --recursive
        if [ $? -ne 0 ]; then
            echo "Failed to retrieve submodules."
            exit 1
        fi
    fi

    cd ./anvil
    eval $(opam env) && opam install . --deps-only && dune build
    RESULT=$?
    RESULTS+=($RESULT)
    footer $RESULT
    cd ../
    return $RESULT
}

build-server() {
    header "Building Language Server..."
    cd ./server
    npm install && npm run build
    RESULT=$?
    RESULTS+=($RESULT)
    footer $RESULT
    cd ../
    return $RESULT
}

build-vscode() {
    header "Building VSCode Extension..."
    cd ./extensions/vscode
    npm install && npm run build:client
    RESULT=$?
    RESULTS+=($RESULT)
    footer $RESULT
    cd ../../
    return $RESULT
}

build-vim() {
    header "Building Vim Extension..."
    cd ./extensions/vim
    npm install && npm run build:client
    RESULT=$?
    RESULTS+=($RESULT)
    footer $RESULT
    cd ../../
    return $RESULT
}

if [[ -z "$@" ]]; then
    echo "Building all components..."
    build-anvil
    build-server
    build-vscode
    build-vim
fi

for arg in "$@"; do
    case $arg in
        anvil)
            build-anvil
            ;;
        server)
            build-server
            ;;
        vscode)
            build-vscode
            ;;
        vim)
            build-vim
            ;;
        *)
            echo "Unknown argument: $arg"
            echo
            echo "Usage: $0 [anvil|server|vscode|vim]"
            echo
            echo "If no arguments are provided, all components will be built."
            echo
            exit 1
            ;;
    esac
done

for i in "${RESULTS[@]}"; do
    if [ $i -ne 0 ]; then
        echo "One or more builds failed."
        exit $i
    fi
done

echo "Completed all builds successfully."
exit 0
