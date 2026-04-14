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

test-anvil() {
    header "Testing Anvil..."

    if [ ! -d "./anvil/test/" ]; then
        echo "Anvil not found. Was the Anvil submodule initialized?" 2>&1
        footer 255
        return 255
    fi

    if [ ! -x bin/anvil ]; then
        echo "Anvil executable not found. Was the Anvil submodule built?"
        footer 255
        return 255
    fi

    echo "Anvil ready."
    footer 0
    return 0
}

test-server() {
    header "Testing Language Server..."

    if [ ! -x bin/anvil ]; then
        echo "Anvil binary unavailable - this test may fail unexpectedly!"
    fi

    cd ./server
    if [ -t 1 ]; then
        npm run test
    else
        # non-interactive, use minimal reporter to avoid cluttering CI logs
        npm run test -- --reporter min
    fi
    RESULT=$?
    RESULTS+=($RESULT)
    footer $RESULT
    cd ../
    return $RESULT
}

test-vscode() {
    header "Testing VSCode Extension..."
    echo "Nothing to do, no tests yet!"
    footer 0
}

test-vim() {
    header "Testing Vim Extension..."
    echo "Nothing to do, no tests yet!"
    footer 0
}

if [[ -z "$@" ]]; then
    echo "Testing all components..."
    test-anvil
    test-server
    test-vscode
    test-vim
fi

for arg in "$@"; do
    case $arg in
        anvil)
            test-anvil
            ;;
        server)
            test-server
            ;;
        vscode)
            test-vscode
            ;;
        vim)
            test-vim
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
        echo "One or more tests failed."
        exit $i
    fi
done

echo "Completed all tests successfully."
exit 0
