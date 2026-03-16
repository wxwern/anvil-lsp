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

format-anvil() {
    header "Formatting Anvil..."
    echo "Submodule is not in scope!"
    footer 0
    return 0
}

format-server() {
    header "Format Language Server..."

    cd ./server
    npm run format
    RESULT=$?
    RESULTS+=($RESULT)
    footer $RESULT
    cd ../
    return $RESULT
}

format-vscode() {
    header "Format VSCode Extension..."
    echo "Nothing to do, no formatter yet!"
    footer 0
}

format-vim() {
    header "Format Vim Extension..."
    echo "Nothing to do, no formatter yet!"
    footer 0
}

if [[ -z "$@" ]]; then
    echo "Formatting all components..."
    format-anvil
    format-server
    format-vscode
    format-vim
fi

for arg in "$@"; do
    case $arg in
        anvil)
            format-anvil
            ;;
        server)
            format-server
            ;;
        vscode)
            format-vscode
            ;;
        vim)
            format-vim
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
        echo "One or more formatters failed."
        exit $i
    fi
done

echo "Ran all formatters successfully."
exit 0
